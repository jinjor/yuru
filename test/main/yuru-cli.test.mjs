import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cliPath = path.resolve("scripts/yuru-cli.mjs");

function read(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    env: cleanGitEnv(process.env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function cleanGitEnv(env) {
  const next = { ...env };
  delete next.GIT_DIR;
  delete next.GIT_WORK_TREE;
  return next;
}

function writeExecutable(filePath, contents) {
  fs.writeFileSync(filePath, contents);
  fs.chmodSync(filePath, 0o755);
}

function createLatestFixture(t, { auditExitCode = 0, npmVersion = "11.16.0" } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-cli-latest-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const repoDir = path.join(tempDir, "repo");
  const binDir = path.join(tempDir, "bin");
  const commandLogPath = path.join(tempDir, "commands.log");
  fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
  fs.mkdirSync(binDir);

  writeExecutable(
    path.join(binDir, "git"),
    `#!/bin/sh
printf 'git %s\\n' "$*" >> "$YURU_COMMAND_LOG"
case "$*" in
  "remote get-url origin") printf 'https://github.com/jinjor/yuru.git\\n' ;;
  "branch --show-current") printf 'main\\n' ;;
esac
`,
  );
  writeExecutable(
    path.join(binDir, "npm"),
    `#!/bin/sh
printf 'npm %s\\n' "$*" >> "$YURU_COMMAND_LOG"
if [ "$1" = "--version" ]; then
  printf '%s\\n' "$YURU_NPM_VERSION"
  exit 0
fi
if [ "$1" = "audit" ]; then
  exit "$YURU_AUDIT_EXIT"
fi
`,
  );
  writeExecutable(path.join(binDir, "ps"), "#!/bin/sh\n");

  return {
    commandLogPath,
    env: cleanGitEnv({
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      YURU_APPLICATIONS_DIR: path.join(tempDir, "Applications"),
      YURU_AUDIT_EXIT: String(auditExitCode),
      YURU_COMMAND_LOG: commandLogPath,
      YURU_NPM_VERSION: npmVersion,
      YURU_REPO_DIR: repoDir,
    }),
  };
}

function runLatest(env) {
  return execFileSync(process.execPath, [cliPath, "latest"], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("yuru add registers the specified Git repository once", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-cli-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const repoDir = path.join(tempDir, "repo");
  const nestedDir = path.join(repoDir, "src");
  const yuruHome = path.join(tempDir, "home");
  fs.mkdirSync(nestedDir, { recursive: true });
  execFileSync("git", ["init"], {
    cwd: repoDir,
    env: cleanGitEnv(process.env),
    stdio: "ignore",
  });

  const env = {
    ...process.env,
    GIT_DIR: "/nonexistent-yuru-test-git-dir",
    YURU_HOME: yuruHome,
  };
  const firstOutput = execFileSync(process.execPath, [cliPath, "add", "repo/src"], {
    cwd: tempDir,
    env,
    encoding: "utf8",
  });
  const secondOutput = execFileSync(process.execPath, [cliPath, "add", "."], {
    cwd: repoDir,
    env,
    encoding: "utf8",
  });

  const metadataPath = path.join(yuruHome, "metadata.json");
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const repoRoot = read("git", ["rev-parse", "--show-toplevel"], repoDir);

  assert.match(firstOutput, /^Added: /);
  assert.match(secondOutput, /^Already added: /);
  assert.equal(metadata.repos.length, 1);
  assert.equal(metadata.repos[0].repoPath, repoRoot);
  assert.equal(typeof metadata.repos[0].id, "string");
});

test("yuru add requires a directory argument", () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [cliPath, "add"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    (error) => {
      assert.equal(error.status, 1);
      assert.equal(error.stderr, "Usage: yuru add <directory>\n");
      return true;
    },
  );
});

test(
  "yuru latest audits the pulled lockfile before installing dependencies",
  { skip: process.platform !== "darwin" },
  (t) => {
    const { commandLogPath, env } = createLatestFixture(t);

    runLatest(env);

    const npmCommands = fs
      .readFileSync(commandLogPath, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line.startsWith("npm "));
    assert.deepEqual(npmCommands, [
      "npm --version",
      "npm audit --package-lock-only --audit-level=high",
      "npm ci",
      "npm run build",
      "npm run package:local",
    ]);
  },
);

test(
  "yuru latest stops before npm ci when the audit fails",
  { skip: process.platform !== "darwin" },
  (t) => {
    const { commandLogPath, env } = createLatestFixture(t, { auditExitCode: 1 });

    assert.throws(() => runLatest(env), (error) => error.status === 1);

    const npmCommands = fs
      .readFileSync(commandLogPath, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line.startsWith("npm "));
    assert.deepEqual(npmCommands, [
      "npm --version",
      "npm audit --package-lock-only --audit-level=high",
    ]);
  },
);

test(
  "yuru latest requires an npm version with install-script policies",
  { skip: process.platform !== "darwin" },
  (t) => {
    const { env } = createLatestFixture(t, { npmVersion: "11.15.0" });

    assert.throws(
      () => runLatest(env),
      (error) =>
        error.status === 1 &&
        error.stderr ===
          "npm 11.16.0 or later is required to update Yuru. Found npm 11.15.0.\n",
    );
  },
);
