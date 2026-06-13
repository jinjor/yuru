import assert from "node:assert/strict";
import test from "node:test";

import { parseWorktreeListPorcelain } from "../../src/main/git.ts";
import { parseNameStatusZ, parseNumstatZ, parsePorcelainLine } from "../../src/main/git-status.ts";

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
