import assert from "node:assert/strict";
import test from "node:test";

import { findRepoByWorktreeId, findRepoByWorktreePath } from "../../../src/main/repos/find-repo.ts";
import { toWorktreeId } from "../../../src/main/worktree-identity.ts";

test("findRepoByWorktreePath は Git worktree 一覧から所属 repo を解決する", async () => {
  const repos = [
    { id: "repo-a", repoPath: "/repos/a" },
    { id: "repo-b", repoPath: "/repos/b" },
  ];
  const listedRepoPaths = [];

  const repo = await findRepoByWorktreePath(
    "/repos/b/.yuru/worktrees/task-b/../task-b",
    repos,
    async (repoPath) => {
      listedRepoPaths.push(repoPath);
      return repoPath === "/repos/a"
        ? [{ path: "/repos/a/.yuru/worktrees/task-a" }]
        : [{ path: "/repos/b/.yuru/worktrees/task-b" }];
    },
    async () => true,
  );

  assert.deepEqual(repo, repos[1]);
  assert.deepEqual(listedRepoPaths, ["/repos/a", "/repos/b"]);
});

test("findRepoByWorktreePath は一致する Git worktree がなければ null を返す", async () => {
  const repo = await findRepoByWorktreePath(
    "/repos/a/.yuru/worktrees/missing",
    [{ id: "repo-a", repoPath: "/repos/a" }],
    async () => [{ path: "/repos/a/.yuru/worktrees/task-a" }],
    async () => true,
  );

  assert.equal(repo, null);
});

test("findRepoByWorktreePath は利用できない登録 repo を読み飛ばす", async () => {
  const repos = [
    { id: "missing", repoPath: "/repos/missing" },
    { id: "repo-a", repoPath: "/repos/a" },
  ];
  const listedRepoPaths = [];

  const repo = await findRepoByWorktreePath(
    "/repos/a/.yuru/worktrees/task-a",
    repos,
    async (repoPath) => {
      listedRepoPaths.push(repoPath);
      return [{ path: "/repos/a/.yuru/worktrees/task-a" }];
    },
    async (repoPath) => repoPath !== "/repos/missing",
  );

  assert.deepEqual(repo, repos[1]);
  assert.deepEqual(listedRepoPaths, ["/repos/a"]);
});

test("findRepoByWorktreeId は worktreeId が持つ repoId から repo を解決する", () => {
  const repos = [
    { id: "repo-a", repoPath: "/repos/a" },
    { id: "repo-b", repoPath: "/repos/b" },
  ];

  // worktree path にコロンが含まれても repoId だけを取り出す。
  const worktreeId = toWorktreeId("repo-b", "/repos/b/.yuru/worktrees/task:1");

  assert.deepEqual(findRepoByWorktreeId(worktreeId, repos), repos[1]);
});

test("findRepoByWorktreeId は未登録の repo と worktreeId でない文字列に null を返す", () => {
  const repos = [{ id: "repo-a", repoPath: "/repos/a" }];

  assert.equal(findRepoByWorktreeId(toWorktreeId("repo-b", "/repos/b"), repos), null);
  assert.equal(findRepoByWorktreeId("/repos/a", repos), null);
});
