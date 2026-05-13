import assert from "node:assert/strict";
import test from "node:test";

import { parseWorktreeListPorcelain } from "../../src/main/git.ts";
import { parsePorcelainLine } from "../../src/main/git-status.ts";

test("parsePorcelainLine は staged と unstaged を分けて解釈する", () => {
  assert.deepEqual(parsePorcelainLine("M  src/app.ts"), {
    path: "src/app.ts",
    indexStatus: "M",
    worktreeStatus: "",
    ignored: false,
  });

  assert.deepEqual(parsePorcelainLine(" M src/app.ts"), {
    path: "src/app.ts",
    indexStatus: "",
    worktreeStatus: "M",
    ignored: false,
  });

  assert.deepEqual(parsePorcelainLine("MM src/app.ts"), {
    path: "src/app.ts",
    indexStatus: "M",
    worktreeStatus: "M",
    ignored: false,
  });
});

test("parsePorcelainLine は untracked と ignored を特別扱いする", () => {
  assert.deepEqual(parsePorcelainLine("?? notes/todo.md"), {
    path: "notes/todo.md",
    indexStatus: "",
    worktreeStatus: "??",
    ignored: false,
  });

  assert.deepEqual(parsePorcelainLine("!! dist/app.js"), {
    path: "dist/app.js",
    indexStatus: "",
    worktreeStatus: "",
    ignored: true,
  });
});

test("parsePorcelainLine は rename の移動先 path を使う", () => {
  assert.deepEqual(parsePorcelainLine("R  old/name.ts -> new/name.ts"), {
    path: "new/name.ts",
    indexStatus: "R",
    worktreeStatus: "",
    ignored: false,
  });
});

test("parseWorktreeListPorcelain は main worktree を除外し detached worktree も返す", () => {
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
  ].join("\n");

  assert.deepEqual(parseWorktreeListPorcelain(output, "/repo"), [
    {
      path: "/repo/.yuru/worktrees/task-a",
      branch: "task-a",
      headSha: "2222222222222222222222222222222222222222",
    },
    {
      path: "/repo/.yuru/worktrees/detached-task",
      branch: null,
      headSha: "3333333333333333333333333333333333333333",
    },
    {
      path: "/repo/.yuru/worktrees/locked-task",
      branch: null,
      headSha: "4444444444444444444444444444444444444444",
    },
  ]);
});
