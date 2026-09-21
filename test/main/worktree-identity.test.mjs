import assert from "node:assert/strict";
import test from "node:test";

const { toRepoId, toWorktreeId, toWorktreePath } = await import(
  "../../src/main/worktree-identity.ts"
);

test("worktreeId からは repoId と正規化した worktree path を取り出せる", () => {
  const worktreeId = toWorktreeId("repo-1", "/repo/.yuru/worktrees/task-a");

  assert.equal(toRepoId(worktreeId), "repo-1");
  assert.equal(toWorktreePath(worktreeId), "/repo/.yuru/worktrees/task-a");
});

test("path にコロンを含んでも repoId と worktree path を取り違えない", () => {
  const worktreeId = toWorktreeId("repo-1", "/repo/a:b/task");

  assert.equal(toRepoId(worktreeId), "repo-1");
  assert.equal(toWorktreePath(worktreeId), "/repo/a:b/task");
});

test("同じ worktree を指す path なら同じ worktreeId になる", () => {
  assert.equal(
    toWorktreeId("repo-1", "/repo/worktrees/task-a/"),
    toWorktreeId("repo-1", "/repo/worktrees/../worktrees/task-a"),
  );
});

test("worktreeId でない文字列からは path を取り出さない", () => {
  assert.equal(toWorktreePath("worktree:repo-1:"), null);
  assert.equal(toWorktreePath("not-a-worktree-id"), null);
});
