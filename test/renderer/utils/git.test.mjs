import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChangedFiles,
  buildStagedFiles,
  buildTreeStatusMap,
  buildUnstagedFiles,
} from "../../../src/renderer/utils/git.ts";

test("buildStagedFiles と buildUnstagedFiles は staged/unstaged を分けて行数を引き継ぐ", () => {
  const pathStates = [
    {
      path: "src/a.ts",
      indexStatus: "M",
      worktreeStatus: "",
      ignored: false,
      stagedLineStat: { added: 2, deleted: 1 },
    },
    { path: "src/b.ts", indexStatus: "", worktreeStatus: "M", ignored: false },
    {
      path: "src/c.ts",
      indexStatus: "A",
      worktreeStatus: "M",
      ignored: false,
      stagedLineStat: { added: 10, deleted: 0 },
      unstagedLineStat: { added: 3, deleted: 2 },
    },
    {
      path: "notes/todo.md",
      indexStatus: "",
      worktreeStatus: "??",
      ignored: false,
      unstagedLineStat: { added: 5, deleted: 0 },
    },
    { path: "dist/app.js", indexStatus: "", worktreeStatus: "", ignored: true },
  ];

  assert.deepEqual(buildStagedFiles(pathStates), [
    { path: "src/a.ts", status: "M", lineStat: { added: 2, deleted: 1 } },
    { path: "src/c.ts", status: "A", lineStat: { added: 10, deleted: 0 } },
  ]);

  assert.deepEqual(buildUnstagedFiles(pathStates), [
    { path: "src/b.ts", status: "M", lineStat: undefined },
    { path: "src/c.ts", status: "M", lineStat: { added: 3, deleted: 2 } },
    { path: "notes/todo.md", status: "??", lineStat: { added: 5, deleted: 0 } },
  ]);
});

test("buildChangedFiles は Files 向けに path ごとの集約状態を返す", () => {
  const pathStates = [
    { path: "src/a.ts", indexStatus: "M", worktreeStatus: "", ignored: false },
    { path: "src/c.ts", indexStatus: "A", worktreeStatus: "M", ignored: false },
    { path: "src/d.ts", indexStatus: "M", worktreeStatus: "D", ignored: false },
    { path: "notes/todo.md", indexStatus: "", worktreeStatus: "??", ignored: false },
  ];

  assert.deepEqual(buildChangedFiles(pathStates), [
    { path: "src/a.ts", status: "M" },
    { path: "src/c.ts", status: "A" },
    { path: "src/d.ts", status: "D" },
    { path: "notes/todo.md", status: "??" },
  ]);
});

test("buildTreeStatusMap は path ごとに優先度の高い変更状態を使う", () => {
  const statuses = buildTreeStatusMap([
    { path: "src/a.ts", indexStatus: "M", worktreeStatus: "", ignored: false },
    { path: "src/nested/b.ts", indexStatus: "A", worktreeStatus: "M", ignored: false },
    { path: "ignored/file.ts", indexStatus: "", worktreeStatus: "", ignored: true },
  ]);

  assert.equal(statuses.get("src"), "A");
  assert.equal(statuses.get("src/nested"), "A");
  assert.equal(statuses.get("src/nested/b.ts"), "A");
  assert.equal(statuses.has("ignored"), false);
});

test("buildTreeStatusMap は worktree 側で削除された file を D として扱う", () => {
  const statuses = buildTreeStatusMap([
    { path: "src/deleted.ts", indexStatus: "M", worktreeStatus: "D", ignored: false },
  ]);

  assert.equal(statuses.get("src"), "D");
  assert.equal(statuses.get("src/deleted.ts"), "D");
});
