import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { listWorktrees, parseWorktreeListPorcelain } from "../../src/main/git.ts";
import { parseNameStatusZ, parseNumstatZ, parsePorcelainLine } from "../../src/main/git-status.ts";

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

test("parsePorcelainLine は staged と unstaged を分けて解釈する", () => {
  assert.deepEqual(parsePorcelainLine("M  src/app.ts"), {
    path: "src/app.ts",
    indexStatus: "M",
    worktreeStatus: "",
    conflicted: false,
    ignored: false,
  });

  assert.deepEqual(parsePorcelainLine(" M src/app.ts"), {
    path: "src/app.ts",
    indexStatus: "",
    worktreeStatus: "M",
    conflicted: false,
    ignored: false,
  });

  assert.deepEqual(parsePorcelainLine("MM src/app.ts"), {
    path: "src/app.ts",
    indexStatus: "M",
    worktreeStatus: "M",
    conflicted: false,
    ignored: false,
  });
});

test("parsePorcelainLine は untracked と ignored を特別扱いする", () => {
  assert.deepEqual(parsePorcelainLine("?? notes/todo.md"), {
    path: "notes/todo.md",
    indexStatus: "",
    worktreeStatus: "??",
    conflicted: false,
    ignored: false,
  });

  assert.deepEqual(parsePorcelainLine("!! dist/app.js"), {
    path: "dist/app.js",
    indexStatus: "",
    worktreeStatus: "",
    conflicted: false,
    ignored: true,
  });
});

test("parsePorcelainLine は rename の移動先 path を使う", () => {
  assert.deepEqual(parsePorcelainLine("R  old/name.ts -> new/name.ts"), {
    path: "new/name.ts",
    indexStatus: "R",
    worktreeStatus: "",
    conflicted: false,
    ignored: false,
  });
});

test("parsePorcelainLine は unmerged な status を conflicted として解釈する", () => {
  for (const rawStatus of ["DD", "AU", "UD", "UA", "DU", "AA", "UU"]) {
    assert.deepEqual(parsePorcelainLine(`${rawStatus} src/app.ts`), {
      path: "src/app.ts",
      indexStatus: "",
      worktreeStatus: "",
      conflicted: true,
      ignored: false,
    });
  }
});

test("parseNumstatZ は path ごとの追加・削除行数を返す", () => {
  const output = "12\t3\tsrc/app.ts\0" + "0\t0\tsrc/mode-only.sh\0";

  assert.deepEqual(
    parseNumstatZ(output),
    new Map([
      ["src/app.ts", { added: 12, deleted: 3 }],
      ["src/mode-only.sh", { added: 0, deleted: 0 }],
    ]),
  );
});

test("parseNumstatZ は空出力で空 Map を返す", () => {
  assert.deepEqual(parseNumstatZ(""), new Map());
});

test("parseNumstatZ は rename を移動先 path で返す", () => {
  const output = "5\t1\t\0old/name.ts\0new/name.ts\0" + "2\t0\tsrc/other.ts\0";

  assert.deepEqual(
    parseNumstatZ(output),
    new Map([
      ["new/name.ts", { added: 5, deleted: 1 }],
      ["src/other.ts", { added: 2, deleted: 0 }],
    ]),
  );
});

test("parseNumstatZ は binary file を行数なしとして除く", () => {
  const output = "-\t-\tassets/icon.png\0" + "1\t0\tsrc/app.ts\0";

  assert.deepEqual(parseNumstatZ(output), new Map([["src/app.ts", { added: 1, deleted: 0 }]]));
});

test("parseNameStatusZ は rename を移動元つきで返す", () => {
  const output = "M\0src/app.ts\0" + "R100\0old/name.ts\0new/name.ts\0" + "A\0src/new.ts\0";

  assert.deepEqual(parseNameStatusZ(output), [
    { status: "M", path: "src/app.ts" },
    { status: "R100", path: "new/name.ts", srcPath: "old/name.ts" },
    { status: "A", path: "src/new.ts" },
  ]);
});

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
