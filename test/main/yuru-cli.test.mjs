import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startApiServer } from "../../src/main/api-server.ts";

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

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
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

test("yuru ping は Yuru API の pong を表示する", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-cli-ping-"));
  const socketPath = path.join(tempDir, "api.sock");
  const server = await startApiServer({ socketPath });
  t.after(async () => {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = await runCli(["ping"], {
    ...process.env,
    YURU_API_SOCKET: socketPath,
  });

  assert.deepEqual(result, {
    code: 0,
    stdout: "pong\n",
    stderr: "",
  });
});

test("yuru ping は Yuru terminal 外では実行しない", async () => {
  const env = { ...process.env };
  delete env.YURU_API_SOCKET;

  const result = await runCli(["ping"], env);

  assert.deepEqual(result, {
    code: 1,
    stdout: "",
    stderr: "Yuru API is unavailable. Run this command inside a Yuru terminal.\n",
  });
});

test("yuru worktree create は呼び出し元 worktree を渡して作成結果を表示する", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-cli-worktree-create-"));
  const socketPath = path.join(tempDir, "api.sock");
  const requests = [];
  const server = await startApiServer({
    socketPath,
    handleRequest(request) {
      requests.push(request);
      return {
        ok: true,
        data: {
          worktreePath: "/repo/.yuru/worktrees/child-task",
          branchName: "child/task",
        },
      };
    },
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = await runCli(["worktree", "create", "child/task"], {
    ...process.env,
    YURU_API_SOCKET: socketPath,
    YURU_WORKTREE_PATH: "/repo/.yuru/worktrees/parent-task",
  });

  assert.deepEqual(result, {
    code: 0,
    stdout:
      "Created worktree /repo/.yuru/worktrees/child-task on branch child/task\n",
    stderr: "",
  });
  assert.deepEqual(requests, [
    {
      command: "worktree.create",
      args: {
        worktreePath: "/repo/.yuru/worktrees/parent-task",
        branchName: "child/task",
      },
    },
  ]);
});

test("yuru worktree create は task worktree terminal 外では実行しない", async () => {
  const env = { ...process.env, YURU_API_SOCKET: "/unused/api.sock" };
  delete env.YURU_WORKTREE_PATH;

  const result = await runCli(["worktree", "create", "child-task"], env);

  assert.deepEqual(result, {
    code: 1,
    stdout: "",
    stderr: "This command must be run inside a Yuru task worktree terminal.\n",
  });
});

test("yuru worktree create は Yuru terminal 外では実行しない", async () => {
  const env = { ...process.env };
  delete env.YURU_API_SOCKET;
  delete env.YURU_WORKTREE_PATH;

  const result = await runCli(["worktree", "create", "child-task"], env);

  assert.deepEqual(result, {
    code: 1,
    stdout: "",
    stderr: "Yuru API is unavailable. Run this command inside a Yuru terminal.\n",
  });
});

test("yuru worktree create は branch name を必須にする", async () => {
  const result = await runCli(["worktree", "create"], process.env);

  assert.deepEqual(result, {
    code: 1,
    stdout: "",
    stderr: "Usage: yuru worktree create <branch-name>\n",
  });
});

test("yuru session create は worktree、provider、prompt を渡して作成結果を表示する", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-cli-session-create-"));
  const socketPath = path.join(tempDir, "api.sock");
  const requests = [];
  const server = await startApiServer({
    socketPath,
    handleRequest(request) {
      requests.push(request);
      return {
        ok: true,
        data: {
          worktreePath: "/repo/.yuru/worktrees/child-task",
          provider: "claude",
          providerSessionId: "claude-session-id",
        },
      };
    },
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = await runCli(
    [
      "session",
      "create",
      "--worktree",
      "/repo/.yuru/worktrees/child-task",
      "--provider",
      "claude",
      "--prompt",
      "Implement step 3.\nKeep the change focused.",
    ],
    {
      ...process.env,
      YURU_API_SOCKET: socketPath,
    },
  );

  assert.deepEqual(result, {
    code: 0,
    stdout: "Created claude session for /repo/.yuru/worktrees/child-task\n",
    stderr: "",
  });
  assert.deepEqual(requests, [
    {
      command: "session.create",
      args: {
        worktreePath: "/repo/.yuru/worktrees/child-task",
        provider: "claude",
        prompt: "Implement step 3.\nKeep the change focused.",
      },
    },
  ]);
});

test("yuru session create は prompt file の内容を渡す", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-cli-session-prompt-file-"));
  const socketPath = path.join(tempDir, "api.sock");
  const promptPath = path.join(tempDir, "handoff.md");
  const requests = [];
  fs.writeFileSync(promptPath, "# Handoff\n\nContinue the implementation.\n");
  const server = await startApiServer({
    socketPath,
    handleRequest(request) {
      requests.push(request);
      return {
        ok: true,
        data: {
          worktreePath: "/repo/.yuru/worktrees/child-task",
          provider: "codex",
          providerSessionId: null,
        },
      };
    },
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = await runCli(
    [
      "session",
      "create",
      "--provider",
      "codex",
      "--prompt-file",
      promptPath,
      "--worktree",
      "/repo/.yuru/worktrees/child-task",
    ],
    { ...process.env, YURU_API_SOCKET: socketPath },
  );

  assert.equal(result.code, 0);
  assert.deepEqual(requests[0].args, {
    worktreePath: "/repo/.yuru/worktrees/child-task",
    provider: "codex",
    prompt: "# Handoff\n\nContinue the implementation.\n",
  });
});

test("yuru session create は prompt と prompt file の同時指定を拒否する", async () => {
  const result = await runCli(
    [
      "session",
      "create",
      "--worktree",
      "/repo/worktree",
      "--provider",
      "kimi",
      "--prompt",
      "task",
      "--prompt-file",
      "/tmp/handoff.md",
    ],
    process.env,
  );

  assert.deepEqual(result, {
    code: 1,
    stdout: "",
    stderr:
      "Usage: yuru session create --worktree <path> --provider <claude|codex|kimi> [--prompt <text> | --prompt-file <path>]\n",
  });
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

    assert.throws(
      () => runLatest(env),
      (error) => error.status === 1,
    );

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
        error.stderr === "npm 11.16.0 or later is required to update Yuru. Found npm 11.15.0.\n",
    );
  },
);
