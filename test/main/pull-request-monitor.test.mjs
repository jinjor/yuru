import assert from "node:assert/strict";
import test from "node:test";

import { PullRequestMonitor } from "../../src/main/pull-request-monitor.ts";
import { toWorktreeId } from "../../src/main/worktree-identity.ts";

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function worktree(path, branch, headSha = "sha-head") {
  return { path, branch, headSha, locked: false };
}

function fetched(prNumber, state, headRefOid = "sha-head") {
  return {
    pullRequest: { prNumber, state, url: `https://example.com/${prNumber}` },
    headRefOid,
  };
}

test("PullRequestMonitor は stop() されたら実行中の tick の残りを取得も push もしない", async () => {
  const fetchedRepoPaths = [];
  const pushes = [];
  let resolveFirstFetch;
  const monitor = new PullRequestMonitor({
    listRepos: () => [
      { id: "repo-1", repoPath: "/repo-1" },
      { id: "repo-2", repoPath: "/repo-2" },
    ],
    listWorktrees: async (repoPath) => [worktree(`${repoPath}/wt`, "task-a")],
    fetchPullRequests: (repoPath) => {
      fetchedRepoPaths.push(repoPath);
      if (repoPath === "/repo-1") {
        return new Promise((resolve) => {
          resolveFirstFetch = resolve;
        });
      }
      return Promise.resolve(new Map([["task-a", null]]));
    },
    hasAliveTerminalRuntimeInRepo: () => true,
    pullRequestsChanged: (updates) => {
      pushes.push(updates);
    },
  });

  monitor.start();
  await flush();
  assert.deepEqual(fetchedRepoPaths, ["/repo-1"]);

  monitor.stop();
  resolveFirstFetch(new Map([["task-a", fetched(1, "open")]]));
  await flush();

  assert.deepEqual(fetchedRepoPaths, ["/repo-1"]);
  assert.deepEqual(pushes, []);
});

test("PullRequestMonitor は変わった worktree の分だけ push する", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const repoPath = "/repo-1";
  const worktreePath = `${repoPath}/wt-a`;
  const pushes = [];
  let currentState = "open";
  const monitor = new PullRequestMonitor({
    listRepos: () => [{ id: "repo-1", repoPath }],
    listWorktrees: async () => [worktree(worktreePath, "task-a")],
    fetchPullRequests: async () => new Map([["task-a", fetched(1, currentState)]]),
    hasAliveTerminalRuntimeInRepo: () => true,
    pullRequestsChanged: (updates) => {
      pushes.push(updates);
    },
  });

  monitor.start();
  await flush();
  assert.deepEqual(pushes, [
    [
      {
        worktreeId: toWorktreeId("repo-1", worktreePath),
        pullRequest: { prNumber: 1, state: "open", url: "https://example.com/1" },
      },
    ],
  ]);

  // 変化なし: push されない
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(pushes.length, 1);

  // draft へ変化: push される
  currentState = "draft";
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(pushes.length, 2);
  assert.equal(pushes[1][0].pullRequest.state, "draft");

  monitor.stop();
});

test("PullRequestMonitor は生きた runtime のない repo を 60 秒間隔でしか取得しない", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 100_000 });
  let fetchCount = 0;
  const monitor = new PullRequestMonitor({
    listRepos: () => [{ id: "repo-1", repoPath: "/repo-1" }],
    listWorktrees: async () => [worktree("/repo-1/wt-a", "task-a")],
    fetchPullRequests: async () => {
      fetchCount += 1;
      return new Map([["task-a", null]]);
    },
    hasAliveTerminalRuntimeInRepo: () => false,
    pullRequestsChanged: () => {},
  });

  monitor.start();
  await flush();
  assert.equal(fetchCount, 1);

  // 10 秒ごとの tick では 60 秒経過するまで取得しない
  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(10_000);
    await flush();
  }
  assert.equal(fetchCount, 1);

  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(fetchCount, 2);

  monitor.stop();
});

test("PullRequestMonitor は merged PR の head が worktree と一致しないとき PR なしとして push する", async () => {
  const repoPath = "/repo-1";
  const pushes = [];
  const monitor = new PullRequestMonitor({
    listRepos: () => [{ id: "repo-1", repoPath }],
    listWorktrees: async () => [
      worktree(`${repoPath}/wt-a`, "task-a", "sha-match"),
      worktree(`${repoPath}/wt-b`, "task-b", "sha-current"),
    ],
    fetchPullRequests: async () =>
      new Map([
        ["task-a", fetched(1, "merged", "sha-match")],
        ["task-b", fetched(2, "merged", "sha-old")],
      ]),
    hasAliveTerminalRuntimeInRepo: () => true,
    pullRequestsChanged: (updates) => {
      pushes.push(updates);
    },
  });

  monitor.start();
  await flush();
  monitor.stop();

  assert.deepEqual(pushes, [
    [
      {
        worktreeId: toWorktreeId("repo-1", `${repoPath}/wt-a`),
        pullRequest: { prNumber: 1, state: "merged", url: "https://example.com/1" },
      },
      {
        worktreeId: toWorktreeId("repo-1", `${repoPath}/wt-b`),
        pullRequest: null,
      },
    ],
  ]);
});
