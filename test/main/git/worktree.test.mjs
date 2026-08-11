import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  branchExists,
  createWorktreeFromOriginBranch,
  fetchOriginBranch,
  listWorktrees,
  parseWorktreeListPorcelain,
} from "../../../src/main/git/worktree.ts";

function runGit(args, cwd) {
  // git hook 経由でテストが走ると GIT_DIR / GIT_WORK_TREE が設定されており、
  // そのまま継承すると一時リポジトリではなく本物のリポジトリを操作してしまう
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Yuru Test",
    GIT_AUTHOR_EMAIL: "yuru@example.test",
    GIT_COMMITTER_NAME: "Yuru Test",
    GIT_COMMITTER_EMAIL: "yuru@example.test",
  };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  execFileSync("git", args, { cwd, stdio: "ignore", env });
}

function runGitOutput(args, cwd) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return execFileSync("git", args, { cwd, encoding: "utf8", env });
}

function createCommittedRepo(repoPath, files) {
  fs.mkdirSync(repoPath);
  runGit(["init", "-b", "main"], repoPath);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(repoPath, name), content);
  }
  runGit(["add", "."], repoPath);
  runGit(["commit", "-m", "initial"], repoPath);
}

test("parseWorktreeListPorcelain は main worktree を除外し detached worktree や locked 状態も返す", () => {
  const output = [
    "worktree /repo",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
    "worktree /repo/.yuru/worktrees/task-a",
    "HEAD 2222222222222222222222222222222222222222",
    "branch refs/heads/task-a",
    "",
    "worktree /repo/.yuru/worktrees/detached-task",
    "HEAD 3333333333333333333333333333333333333333",
    "detached",
    "",
    "worktree /repo/.yuru/worktrees/locked-task",
    "HEAD 4444444444444444444444444444444444444444",
    "detached",
    "locked testing",
    "",
    "worktree /repo/.yuru/worktrees/locked-no-reason-task",
    "HEAD 5555555555555555555555555555555555555555",
    "detached",
    "locked",
    "",
  ].join("\n");

  assert.deepEqual(parseWorktreeListPorcelain(output, "/repo"), [
    {
      path: "/repo/.yuru/worktrees/task-a",
      branch: "task-a",
      headSha: "2222222222222222222222222222222222222222",
      locked: false,
    },
    {
      path: "/repo/.yuru/worktrees/detached-task",
      branch: null,
      headSha: "3333333333333333333333333333333333333333",
      locked: false,
    },
    {
      path: "/repo/.yuru/worktrees/locked-task",
      branch: null,
      headSha: "4444444444444444444444444444444444444444",
      locked: true,
    },
    {
      path: "/repo/.yuru/worktrees/locked-no-reason-task",
      branch: null,
      headSha: "5555555555555555555555555555555555555555",
      locked: true,
    },
  ]);
});

test("parseWorktreeListPorcelain は prunable な worktree を除外する", () => {
  const output = [
    "worktree /repo",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
    "worktree /repo/.yuru/worktrees/task-a",
    "HEAD 2222222222222222222222222222222222222222",
    "branch refs/heads/task-a",
    "",
    "worktree /repo/.yuru/worktrees/gone-task",
    "HEAD 3333333333333333333333333333333333333333",
    "branch refs/heads/gone-task",
    "prunable gitdir file points to non-existent location",
    "",
  ].join("\n");

  assert.deepEqual(parseWorktreeListPorcelain(output, "/repo"), [
    {
      path: "/repo/.yuru/worktrees/task-a",
      branch: "task-a",
      headSha: "2222222222222222222222222222222222222222",
      locked: false,
    },
  ]);
});

test("listWorktrees は path の辞書順ではなく作成順で返す", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-worktree-order-test-"));
  const repoPath = path.join(root, "repo");
  fs.mkdirSync(repoPath);

  try {
    runGit(["init", "-b", "main"], repoPath);
    fs.writeFileSync(path.join(repoPath, "README.md"), "# test\n");
    runGit(["add", "README.md"], repoPath);
    runGit(["commit", "-m", "initial"], repoPath);

    for (const branch of ["z-created-first", "a-created-second", "m-created-third"]) {
      runGit(["worktree", "add", "-b", branch, path.join(root, branch)], repoPath);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const worktrees = await listWorktrees(repoPath);
    assert.deepEqual(
      worktrees.map((worktree) => worktree.branch),
      ["z-created-first", "a-created-second", "m-created-third"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("branchExists は local branch だけを見て同名の tag に反応しない", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-branch-exists-test-"));
  const repoPath = path.join(root, "repo");

  try {
    createCommittedRepo(repoPath, { "README.md": "# test\n" });
    runGit(["tag", "release-note"], repoPath);

    assert.equal(await branchExists(repoPath, "release-note"), false);

    runGit(["branch", "release-note"], repoPath);
    assert.equal(await branchExists(repoPath, "release-note"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fetchOriginBranch と createWorktreeFromOriginBranch で remote branch から worktree を作る", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-remote-branch-test-"));
  const remotePath = path.join(root, "remote");
  const repoPath = path.join(root, "repo");

  try {
    createCommittedRepo(remotePath, { "README.md": "# remote\n" });
    runGit(["switch", "-c", "feature/pr-head"], remotePath);
    fs.writeFileSync(path.join(remotePath, "pr.txt"), "from pr\n");
    runGit(["add", "pr.txt"], remotePath);
    runGit(["commit", "-m", "pr work"], remotePath);

    createCommittedRepo(repoPath, { "README.md": "# local\n" });
    runGit(["remote", "add", "origin", remotePath], repoPath);

    await fetchOriginBranch(repoPath, "feature/pr-head");
    const worktreePath = path.join(repoPath, ".yuru", "worktrees", "feature-pr-head");
    await createWorktreeFromOriginBranch(repoPath, worktreePath, "feature/pr-head");

    assert.equal(fs.readFileSync(path.join(worktreePath, "pr.txt"), "utf8"), "from pr\n");
    assert.equal(
      runGitOutput(["rev-parse", "--abbrev-ref", "feature/pr-head@{upstream}"], worktreePath).trim(),
      "origin/feature/pr-head",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fetchOriginBranch は origin に無い branch で失敗する", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-remote-branch-missing-test-"));
  const remotePath = path.join(root, "remote");
  const repoPath = path.join(root, "repo");

  try {
    createCommittedRepo(remotePath, { "README.md": "# remote\n" });
    createCommittedRepo(repoPath, { "README.md": "# local\n" });
    runGit(["remote", "add", "origin", remotePath], repoPath);

    await assert.rejects(fetchOriginBranch(repoPath, "no-such-branch"), /no-such-branch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("listWorktrees はディレクトリが消えた (prunable) worktree を除外する", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-worktree-prunable-test-"));
  const repoPath = path.join(root, "repo");
  fs.mkdirSync(repoPath);

  try {
    runGit(["init", "-b", "main"], repoPath);
    fs.writeFileSync(path.join(repoPath, "README.md"), "# test\n");
    runGit(["add", "README.md"], repoPath);
    runGit(["commit", "-m", "initial"], repoPath);
    runGit(["worktree", "add", "-b", "alive", path.join(root, "alive")], repoPath);
    runGit(["worktree", "add", "-b", "gone", path.join(root, "gone")], repoPath);
    fs.rmSync(path.join(root, "gone"), { recursive: true, force: true });

    const worktrees = await listWorktrees(repoPath);
    assert.deepEqual(
      worktrees.map((worktree) => worktree.branch),
      ["alive"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
