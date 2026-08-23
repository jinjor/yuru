import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startApiServer } from "../../src/main/api/server.ts";

const cliPath = path.resolve("scripts/yuru-cli/index.mjs");

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
  const yuruHome = path.join(tempDir, ".yuru");
  const launcherPath = path.join(yuruHome, "bin", "yuru");
  const commandLogPath = path.join(tempDir, "commands.log");
  fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repoDir, "bin"));
  fs.mkdirSync(binDir);

  writeExecutable(path.join(repoDir, "bin", "yuru"), "updated yuru launcher\n");

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
    launcherPath,
    env: cleanGitEnv({
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      YURU_APPLICATIONS_DIR: path.join(tempDir, "Applications"),
      YURU_AUDIT_EXIT: String(auditExitCode),
      YURU_COMMAND_LOG: commandLogPath,
      YURU_HOME: yuruHome,
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

test("yuru add keeps the worktree order of already registered repositories", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-cli-order-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const repoDir = path.join(tempDir, "repo");
  const yuruHome = path.join(tempDir, "home");
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(yuruHome, { recursive: true });
  execFileSync("git", ["init"], {
    cwd: repoDir,
    env: cleanGitEnv(process.env),
    stdio: "ignore",
  });
  const metadataPath = path.join(yuruHome, "metadata.json");
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        repos: [
          { id: "repo-1", repoPath: "/tmp/other-repo", worktreeOrder: ["/tmp/wt-b", "/tmp/wt-a"] },
        ],
        taskWorktrees: [],
      },
      null,
      2,
    )}\n`,
  );

  execFileSync(process.execPath, [cliPath, "add", "."], {
    cwd: repoDir,
    env: {
      ...process.env,
      GIT_DIR: "/nonexistent-yuru-test-git-dir",
      YURU_HOME: yuruHome,
    },
    encoding: "utf8",
  });

  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  assert.deepEqual(metadata.repos[0], {
    id: "repo-1",
    repoPath: "/tmp/other-repo",
    worktreeOrder: ["/tmp/wt-b", "/tmp/wt-a"],
  });
  assert.equal(metadata.repos.length, 2);
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

test("yuru worktree create は現在の repo を渡して作成結果を表示する", async (t) => {
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
    YURU_REPO_PATH: "/repo",
  });

  assert.deepEqual(result, {
    code: 0,
    stdout: "Created worktree /repo/.yuru/worktrees/child-task on branch child/task\n",
    stderr: "",
  });
  assert.deepEqual(requests, [
    {
      command: "worktree.create",
      args: {
        repoPath: "/repo",
        branchName: "child/task",
      },
    },
  ]);
});

test("yuru worktree create は --repo で別の repo を指定できる", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-cli-cross-repo-worktree-"));
  const socketPath = path.join(tempDir, "api.sock");
  const requests = [];
  const server = await startApiServer({
    socketPath,
    handleRequest(request) {
      requests.push(request);
      return {
        ok: true,
        data: {
          worktreePath: "/other/.yuru/worktrees/child-task",
          branchName: "child-task",
        },
      };
    },
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = await runCli(["worktree", "create", "child-task", "--repo", "/other"], {
    ...process.env,
    YURU_API_SOCKET: socketPath,
    YURU_REPO_PATH: "/current",
  });

  assert.deepEqual(result, {
    code: 0,
    stdout: "Created worktree /other/.yuru/worktrees/child-task on branch child-task\n",
    stderr: "",
  });
  assert.deepEqual(requests, [
    {
      command: "worktree.create",
      args: {
        repoPath: "/other",
        branchName: "child-task",
      },
    },
  ]);
});

test("yuru worktree create は現在の repo がなければ明示指定を求める", async () => {
  const env = { ...process.env, YURU_API_SOCKET: "/unused/api.sock" };
  delete env.YURU_REPO_PATH;

  const result = await runCli(["worktree", "create", "child-task"], env);

  assert.deepEqual(result, {
    code: 1,
    stdout: "",
    stderr: "No repository target is available. Pass --repo <absolute-repo-path>.\n",
  });
});

test("yuru worktree create は Yuru terminal 外では実行しない", async () => {
  const env = { ...process.env };
  delete env.YURU_API_SOCKET;
  delete env.YURU_REPO_PATH;

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
    stderr: "Usage: yuru worktree create <branch-name> [--repo <absolute-repo-path>]\n",
  });
});

test("yuru session create は worktree、provider、model、prompt を渡して作成結果を表示する", async (t) => {
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
          agentSessionId: "claude-session-id",
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
      "--model",
      "claude-sonnet-5",
      "--prompt",
      "Implement step 3.\nKeep the change focused.",
    ],
    {
      ...process.env,
      YURU_API_SOCKET: socketPath,
      YURU_WORKTREE_PATH: "/repo/.yuru/worktrees/current-task",
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
        model: "claude-sonnet-5",
        prompt: "Implement step 3.\nKeep the change focused.",
      },
    },
  ]);
});

test("yuru session create は --worktree 省略時に現在の worktree を渡す", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-cli-current-session-"));
  const socketPath = path.join(tempDir, "api.sock");
  const requests = [];
  const server = await startApiServer({
    socketPath,
    handleRequest(request) {
      requests.push(request);
      return {
        ok: true,
        data: {
          worktreePath: "/repo",
          provider: "codex",
          agentSessionId: null,
        },
      };
    },
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = await runCli(["session", "create", "--provider", "codex"], {
    ...process.env,
    YURU_API_SOCKET: socketPath,
    YURU_WORKTREE_PATH: "/repo",
  });

  assert.deepEqual(result, {
    code: 0,
    stdout: "Created codex session for /repo\n",
    stderr: "",
  });
  assert.deepEqual(requests, [
    {
      command: "session.create",
      args: {
        worktreePath: "/repo",
        provider: "codex",
      },
    },
  ]);
});

test("yuru session create は現在の worktree がなければ明示指定を求める", async () => {
  const env = { ...process.env, YURU_API_SOCKET: "/unused/api.sock" };
  delete env.YURU_WORKTREE_PATH;

  const result = await runCli(["session", "create", "--provider", "codex"], env);

  assert.deepEqual(result, {
    code: 1,
    stdout: "",
    stderr: "No worktree target is available. Pass --worktree <absolute-worktree-path>.\n",
  });
});

test(
  "yuru latest audits the pulled lockfile before installing dependencies",
  { skip: process.platform !== "darwin" },
  (t) => {
    const { commandLogPath, env, launcherPath } = createLatestFixture(t);

    runLatest(env);

    assert.equal(fs.readFileSync(launcherPath, "utf8"), "updated yuru launcher\n");
    assert.equal(fs.statSync(launcherPath).mode & 0o777, 0o755);
    assert.equal(fs.existsSync(`${launcherPath}.new`), false);

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
    const { commandLogPath, env, launcherPath } = createLatestFixture(t, {
      auditExitCode: 1,
    });

    assert.throws(
      () => runLatest(env),
      (error) => error.status === 1,
    );

    assert.equal(fs.readFileSync(launcherPath, "utf8"), "updated yuru launcher\n");

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
