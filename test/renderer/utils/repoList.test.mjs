import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPullRequestUpdates,
  applySessionUpdate,
} from "../../../src/renderer/utils/repoList.ts";

function primarySession(runtimeId, preview = "before") {
  return {
    provider: "codex",
    providerSessionKey: `codex:${runtimeId}`,
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
    primarySession: options.primarySession,
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

test("applySessionUpdate は該当 runtime の worktree と repo だけを差し替える", () => {
  const target = worktree("target", {
    primarySession: primarySession("runtime-target"),
    suggestedSessions: [suggestedSession("runtime-suggested")],
  });
  const sibling = worktree("sibling", {
    primarySession: primarySession("runtime-sibling"),
  });
  const otherRepo = repo("repo-b", [
    worktree("other", { primarySession: primarySession("runtime-other") }),
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
  assert.equal(next[0].taskWorktrees[0].primarySession.preview, "after");
  assert.equal(next[0].taskWorktrees[0].primarySession.activityState, "working");
  assert.strictEqual(next[0].taskWorktrees[0].suggestedSessions, target.suggestedSessions);
});

test("applySessionUpdate は suggested session の更新にも同じ参照保存を行う", () => {
  const primary = primarySession("runtime-primary");
  const targetSuggested = suggestedSession("runtime-target");
  const untouchedSuggested = suggestedSession("runtime-untouched");
  const target = worktree("target", {
    primarySession: primary,
    suggestedSessions: [targetSuggested, untouchedSuggested],
  });
  const repos = [repo("repo-a", [target])];

  const next = applySessionUpdate(repos, "runtime-target", { preview: "after" });

  assert.notStrictEqual(next[0].taskWorktrees[0], target);
  assert.strictEqual(next[0].taskWorktrees[0].primarySession, primary);
  assert.notStrictEqual(next[0].taskWorktrees[0].suggestedSessions, target.suggestedSessions);
  assert.notStrictEqual(next[0].taskWorktrees[0].suggestedSessions[0], targetSuggested);
  assert.strictEqual(next[0].taskWorktrees[0].suggestedSessions[1], untouchedSuggested);
  assert.equal(next[0].taskWorktrees[0].suggestedSessions[0].preview, "after");
});

test("applySessionUpdate は該当 runtime がなければ元の repos を返す", () => {
  const repos = [
    repo("repo-a", [worktree("task", { primarySession: primarySession("runtime-existing") })]),
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
