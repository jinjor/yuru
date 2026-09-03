import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPullRequestUpdates,
  applySessionUpdate,
  collectKeepAliveWorktrees,
  sortPrimarySessionsByKeys,
  sortReposByIds,
  sortTaskWorktreesByPaths,
} from "../../../src/renderer/repos/repoListState.ts";

function primarySession(runtimeId, preview = "before") {
  return {
    provider: "codex",
    agentSessionKey: `codex:${runtimeId}`,
    activeTerminalRuntimeId: runtimeId,
    state: "active",
    activityState: "waiting",
    preview,
  };
}

function suggestedSession(runtimeId, preview = "before") {
  return {
    ...primarySession(runtimeId, preview),
    timestamp: 1,
  };
}

function worktree(worktreeId, options = {}) {
  return {
    worktreeId,
    worktreePath: `/repo/${worktreeId}`,
    name: worktreeId,
    branch: worktreeId,
    headSha: "head",
    primarySessions: options.primarySessions ?? [],
    suggestedSessions: options.suggestedSessions ?? [],
    githubPullRequest: options.githubPullRequest,
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
  const unvisitedActive = worktree("unvisited-active", {
    primarySessions: [primarySession("runtime-unvisited-active")],
  });
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
  const duplicateMainId = worktree("repo-a-main", {
    primarySessions: [primarySession("runtime-duplicate")],
  });
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

test("applySessionUpdate は該当 runtime の worktree と repo だけを差し替える", () => {
  const secondary = primarySession("runtime-secondary");
  const target = worktree("target", {
    primarySessions: [primarySession("runtime-target"), secondary],
    suggestedSessions: [suggestedSession("runtime-suggested")],
  });
  const sibling = worktree("sibling", {
    primarySessions: [primarySession("runtime-sibling")],
  });
  const otherRepo = repo("repo-b", [
    worktree("other", { primarySessions: [primarySession("runtime-other")] }),
  ]);
  const repos = [repo("repo-a", [target, sibling]), otherRepo];

  const next = applySessionUpdate(repos, "runtime-target", {
    activityState: "working",
    preview: "after",
  });

  assert.notStrictEqual(next, repos);
  assert.notStrictEqual(next[0], repos[0]);
  assert.strictEqual(next[1], repos[1]);
  assert.strictEqual(next[0].mainWorktree, repos[0].mainWorktree);
  assert.notStrictEqual(next[0].taskWorktrees[0], target);
  assert.strictEqual(next[0].taskWorktrees[1], sibling);
  assert.equal(next[0].taskWorktrees[0].primarySessions[0].preview, "after");
  assert.equal(next[0].taskWorktrees[0].primarySessions[0].activityState, "working");
  assert.strictEqual(next[0].taskWorktrees[0].primarySessions[1], secondary);
  assert.strictEqual(next[0].taskWorktrees[0].suggestedSessions, target.suggestedSessions);
});

test("applySessionUpdate は2件目以降の primary も runtime id で更新する", () => {
  const target = worktree("target", {
    primarySessions: [primarySession("runtime-primary"), primarySession("runtime-secondary")],
  });
  const repos = [repo("repo-a", [target])];

  const next = applySessionUpdate(repos, "runtime-secondary", { preview: "after" });

  assert.notStrictEqual(next, repos);
  assert.strictEqual(next[0].taskWorktrees[0].primarySessions[0], target.primarySessions[0]);
  assert.notStrictEqual(next[0].taskWorktrees[0].primarySessions[1], target.primarySessions[1]);
  assert.equal(next[0].taskWorktrees[0].primarySessions[1].preview, "after");
});

test("applySessionUpdate は suggested session の更新にも同じ参照保存を行う", () => {
  const primary = primarySession("runtime-primary");
  const targetSuggested = suggestedSession("runtime-target");
  const untouchedSuggested = suggestedSession("runtime-untouched");
  const target = worktree("target", {
    primarySessions: [primary],
    suggestedSessions: [targetSuggested, untouchedSuggested],
  });
  const repos = [repo("repo-a", [target])];

  const next = applySessionUpdate(repos, "runtime-target", { preview: "after" });

  assert.notStrictEqual(next[0].taskWorktrees[0], target);
  assert.strictEqual(next[0].taskWorktrees[0].primarySessions[0], primary);
  assert.notStrictEqual(next[0].taskWorktrees[0].suggestedSessions, target.suggestedSessions);
  assert.notStrictEqual(next[0].taskWorktrees[0].suggestedSessions[0], targetSuggested);
  assert.strictEqual(next[0].taskWorktrees[0].suggestedSessions[1], untouchedSuggested);
  assert.equal(next[0].taskWorktrees[0].suggestedSessions[0].preview, "after");
});

test("applySessionUpdate は該当 runtime がなければ元の repos を返す", () => {
  const repos = [
    repo("repo-a", [worktree("task", { primarySessions: [primarySession("runtime-existing")] })]),
  ];

  assert.strictEqual(applySessionUpdate(repos, "runtime-missing", { preview: "after" }), repos);
});

test("applyPullRequestUpdates は該当 worktree の worktree と repo だけを差し替える", () => {
  const target = worktree("target");
  const sibling = worktree("sibling");
  const otherRepo = repo("repo-b", [worktree("other")]);
  const repos = [repo("repo-a", [target, sibling]), otherRepo];
  const pullRequest = {
    prNumber: 51,
    state: "open",
    isApproved: false,
    url: "https://example.com/pull/51",
  };

  const next = applyPullRequestUpdates(repos, [{ worktreeId: "target", pullRequest }]);

  assert.notStrictEqual(next, repos);
  assert.notStrictEqual(next[0], repos[0]);
  assert.strictEqual(next[1], repos[1]);
  assert.strictEqual(next[0].mainWorktree, repos[0].mainWorktree);
  assert.notStrictEqual(next[0].taskWorktrees[0], target);
  assert.strictEqual(next[0].taskWorktrees[1], sibling);
  assert.strictEqual(next[0].taskWorktrees[0].githubPullRequest, pullRequest);
});

test("applyPullRequestUpdates は該当 worktree がなければ元の repos を返す", () => {
  const repos = [repo("repo-a", [worktree("task")])];

  assert.strictEqual(
    applyPullRequestUpdates(repos, [{ worktreeId: "missing", pullRequest: null }]),
    repos,
  );
});

test("applyPullRequestUpdates は PR の値が同じなら元の repos を返す", () => {
  const githubPullRequest = {
    prNumber: 51,
    state: "open",
    isApproved: true,
    url: "https://example.com/pull/51",
  };
  const repos = [repo("repo-a", [worktree("task", { githubPullRequest })])];

  assert.strictEqual(
    applyPullRequestUpdates(repos, [{ worktreeId: "task", pullRequest: { ...githubPullRequest } }]),
    repos,
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

test("sortPrimarySessionsByKeys は対象 worktree の primary session を渡された順に並べ替える", () => {
  const repos = [
    repo("repo-a", [
      worktree("wt-1", {
        primarySessions: [primarySession("run-1"), primarySession("run-2"), primarySession("run-3")],
      }),
      worktree("wt-2", { primarySessions: [primarySession("run-4")] }),
    ]),
    repo("repo-b", []),
  ];

  const next = sortPrimarySessionsByKeys(repos, "wt-1", ["codex:run-3", "codex:run-1", "codex:run-2"]);

  assert.deepEqual(
    next[0].taskWorktrees[0].primarySessions.map((entry) => entry.agentSessionKey),
    ["codex:run-3", "codex:run-1", "codex:run-2"],
  );
  // 並び替えは worktree も repo もまたがない。
  assert.strictEqual(next[0].taskWorktrees[1], repos[0].taskWorktrees[1]);
  assert.strictEqual(next[1], repos[1]);
});
