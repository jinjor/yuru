import assert from "node:assert/strict";
import test from "node:test";

import { parseLsofCwdPaths } from "../../src/main/worktree-process-check.ts";
import { isPathWithin } from "../../src/main/worktree-identity.ts";

test("parseLsofCwdPaths は lsof -F pn 出力から cwd パス (n 行) だけ取り出す", () => {
  const output = [
    "p411",
    "fcwd",
    "n/",
    "p597",
    "fcwd",
    "n/Users/jinjor/projects/yuru/.git/worktrees/task-a",
  ].join("\n");

  assert.deepEqual(parseLsofCwdPaths(output), [
    "/",
    "/Users/jinjor/projects/yuru/.git/worktrees/task-a",
  ]);
});

test("parseLsofCwdPaths は空出力で空配列を返す", () => {
  assert.deepEqual(parseLsofCwdPaths(""), []);
});

test("isPathWithin は同一パスと配下のみ true にする", () => {
  const worktree = "/repo/.git/worktrees/task-a";

  assert.equal(isPathWithin(worktree, worktree), true);
  assert.equal(isPathWithin(worktree, `${worktree}/src/app.ts`), true);
  // 同じ接頭辞でも別ディレクトリ (task-a と task-ab) は外
  assert.equal(isPathWithin(worktree, "/repo/.git/worktrees/task-ab"), false);
  assert.equal(isPathWithin(worktree, "/repo"), false);
  assert.equal(isPathWithin(worktree, "/other"), false);
});
