import assert from "node:assert/strict";
import test from "node:test";

import {
  collectKeepAliveWorktrees,
  sortReposByIds,
  sortTaskWorktreesByPaths,
} from "../../../src/renderer/repos/repoListState.ts";

function worktree(worktreeId, options = {}) {
  return {
    worktreeId,
    worktreePath: `/repo/${worktreeId}`,
    name: worktreeId,
    branch: worktreeId,
    headSha: "head",
    ...(options.isMainWorktree ? { isMainWorktree: true } : {}),
  };
}

function repo(id, taskWorktrees) {
  return {
    id,
    repoPath: `/${id}`,
    mainWorktree: worktree(`${id}-main`, { isMainWorktree: true }),
    taskWorktrees,
  };
}

test("collectKeepAliveWorktrees は repo 順で main・訪問済み・選択中を重複なく返す", () => {
  const visitedSelected = worktree("visited-selected");
  const visitedOther = worktree("visited-other");
  const unvisitedActive = worktree("unvisited-active");
  const unvisited = worktree("unvisited");
  const repos = [
    repo("repo-a", [unvisited, visitedSelected]),
    repo("repo-b", [visitedOther, unvisitedActive]),
  ];
  const visitedWorktreeIds = new Set(["visited-selected", "visited-other"]);

  // 訪問済みなら session の有無に関わらず含む。session が active でも未訪問なら含まない
  // (keep-alive の単位は worktree であって session ではない)。
  assert.deepEqual(
    collectKeepAliveWorktrees(repos, "visited-selected", visitedWorktreeIds).map(
      ({ repo, worktree }) => [repo.id, worktree.worktreeId],
    ),
    [
      ["repo-a", "repo-a-main"],
      ["repo-a", "visited-selected"],
      ["repo-b", "repo-b-main"],
      ["repo-b", "visited-other"],
    ],
  );

  // 選択中は visited に無くても単独で含む。
  assert.deepEqual(
    collectKeepAliveWorktrees(repos, "unvisited", new Set()).map(
      ({ repo, worktree }) => [repo.id, worktree.worktreeId],
    ),
    [
      ["repo-a", "repo-a-main"],
      ["repo-a", "unvisited"],
      ["repo-b", "repo-b-main"],
    ],
  );
});

test("collectKeepAliveWorktrees は選択中の main worktree を重複させない", () => {
  const duplicateMainId = worktree("repo-a-main");
  const repos = [repo("repo-a", []), repo("repo-b", [duplicateMainId])];

  assert.deepEqual(
    collectKeepAliveWorktrees(repos, "repo-a-main", new Set()).map(
      ({ repo, worktree }) => [repo.id, worktree.worktreeId],
    ),
    [
      ["repo-a", "repo-a-main"],
      ["repo-b", "repo-b-main"],
    ],
  );
});

test("sortReposByIds は渡された ID の順に並べ替える", () => {
  const repos = [repo("repo-a", []), repo("repo-b", []), repo("repo-c", [])];

  const next = sortReposByIds(repos, ["repo-c", "repo-a", "repo-b"]);

  assert.deepEqual(
    next.map((entry) => entry.id),
    ["repo-c", "repo-a", "repo-b"],
  );
  assert.strictEqual(next[0], repos[2]);
});

test("sortReposByIds は ID に無い repo を末尾に残す", () => {
  const repos = [repo("repo-a", []), repo("repo-b", [])];

  const next = sortReposByIds(repos, ["repo-b"]);

  assert.deepEqual(
    next.map((entry) => entry.id),
    ["repo-b", "repo-a"],
  );
});

test("sortTaskWorktreesByPaths は対象 repo の task worktree を渡された順に並べ替える", () => {
  const repos = [
    repo("repo-a", [worktree("wt-1"), worktree("wt-2"), worktree("wt-3")]),
    repo("repo-b", [worktree("wt-4")]),
  ];

  const next = sortTaskWorktreesByPaths(repos, "repo-a", [
    "/repo/wt-3",
    "/repo/wt-1",
    "/repo/wt-2",
  ]);

  assert.deepEqual(
    next[0].taskWorktrees.map((entry) => entry.worktreeId),
    ["wt-3", "wt-1", "wt-2"],
  );
  assert.strictEqual(next[1], repos[1]);
});
