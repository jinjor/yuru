import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-metadata-test-"));
const metadataPath = path.join(tempDir, "metadata.json");
process.env.YURU_METADATA_PATH = metadataPath;
process.env.YURU_HOME = tempDir;

const {
  attachPrimarySessionByPath,
  detachPrimarySessionByPath,
  findRepoByPath,
  loadMetadata,
  parseMetadata,
  removeTaskWorktreeByPath,
  upsertTaskWorktree,
} = await import("../../../src/main/repos/metadata.ts");
const { loadRepoList } = await import("../../../src/main/repos/repo-list.ts");
const { cleanupStaleTaskWorktrees } = await import("../../../src/main/repos/maintenance.ts");
const { toWorktreeId } = await import("../../../src/main/worktree-identity.ts");
const { toSessionKey } = await import("../../../src/shared/session.ts");

function reset() {
  fs.rmSync(metadataPath, { force: true });
}

function seed(metadata) {
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

function listGitWorktreesFrom(worktreesByRepoPath) {
  return async (repoPath) => worktreesByRepoPath.get(repoPath) ?? [];
}

function runGit(args, cwd, envOverrides = {}) {
  // git hook 経由でテストが走ると GIT_DIR / GIT_WORK_TREE が設定されており、
  // そのまま継承すると一時リポジトリではなく本物のリポジトリを操作してしまう
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Yuru Test",
    GIT_AUTHOR_EMAIL: "yuru@example.test",
    GIT_COMMITTER_NAME: "Yuru Test",
    GIT_COMMITTER_EMAIL: "yuru@example.test",
    ...envOverrides,
  };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  execFileSync("git", args, { cwd, stdio: "ignore", env });
}

let repoSequence = 0;
function createGitRepo(name) {
  const repoPath = path.join(tempDir, `${name}-${repoSequence++}`);
  fs.mkdirSync(repoPath);
  runGit(["init"], repoPath);
  runGit(["symbolic-ref", "HEAD", "refs/heads/main"], repoPath);
  return repoPath;
}

test.beforeEach(reset);
test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test("parseMetadata は repos 未定義でも空配列を返す", () => {
  assert.deepEqual(parseMetadata({}), { repos: [], taskWorktrees: [] });
});

test("parseMetadata は taskWorktrees の primarySessions を読み取る", () => {
  const result = parseMetadata({
    repos: [],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/wt",
        primarySessions: [
          { provider: "claude", agentSessionId: "abc" },
          { provider: "kimi", agentSessionId: "session_def" },
        ],
      },
    ],
  });
  assert.deepEqual(result.taskWorktrees[0].primarySessions, [
    { provider: "claude", agentSessionId: "abc" },
    { provider: "kimi", agentSessionId: "session_def" },
  ]);
});

test("parseMetadata は旧 primarySession を単要素配列に migrate する", () => {
  const result = parseMetadata({
    repos: [],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/wt",
        primarySession: { provider: "claude", agentSessionId: "abc" },
      },
    ],
  });

  assert.deepEqual(result.taskWorktrees[0].primarySessions, [
    { provider: "claude", agentSessionId: "abc" },
  ]);
});

test("parseMetadata は旧 providerSessionId を agentSessionId として読む", () => {
  const result = parseMetadata({
    repos: [],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/wt",
        primarySessions: [{ provider: "claude", providerSessionId: "abc" }],
      },
    ],
  });

  assert.deepEqual(result.taskWorktrees[0].primarySessions, [
    { provider: "claude", agentSessionId: "abc" },
  ]);
});

test("parseMetadata は不正な provider を弾く", () => {
  assert.throws(() =>
    parseMetadata({
      repos: [],
      taskWorktrees: [
        {
          repoId: "repo-1",
          worktreePath: "/tmp/wt",
          primarySessions: [{ provider: "unknown", agentSessionId: "abc" }],
        },
      ],
    }),
  );
});

test("parseMetadata は型違いの repos を弾く", () => {
  assert.throws(() => parseMetadata({ repos: "not-array" }));
});

test("parseMetadata は配列ではない primarySessions を弾く", () => {
  assert.throws(() =>
    parseMetadata({
      taskWorktrees: [{ repoId: "repo-1", worktreePath: "/tmp/wt", primarySessions: {} }],
    }),
  );
});

test("findRepoByPath は登録済みの repo を返す", () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo" }],
    taskWorktrees: [],
  });
  assert.deepEqual(findRepoByPath("/tmp/repo"), {
    id: "repo-1",
    repoPath: "/tmp/repo",
  });
  assert.equal(findRepoByPath("/tmp/missing"), null);
});

test("loadRepoList は Git worktree に metadata の primary 状態を重ねて返す", async () => {
  const repoA = createGitRepo("repo-a");
  const repoB = createGitRepo("repo-b");
  const taskA = path.join(repoA, ".yuru/worktrees/task-a");
  const taskB = path.join(repoA, ".yuru/worktrees/task-b");
  const gitOnly = path.join(repoA, ".yuru/worktrees/git-only");
  const missingTask = path.join(repoA, ".yuru/worktrees/missing-task");
  seed({
    repos: [
      { id: "repo-1", repoPath: repoA },
      { id: "repo-2", repoPath: repoB },
    ],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: taskA,
        primarySessions: [{ provider: "codex", agentSessionId: "codex-1" }],
      },
      {
        repoId: "repo-1",
        worktreePath: taskB,
      },
      {
        repoId: "repo-1",
        worktreePath: missingTask,
        primarySessions: [{ provider: "claude", agentSessionId: "claude-1" }],
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        repoA,
        [
          { path: taskA, branch: "task-a", headSha: "abc1234abc1234abc1234abc1234abc1234abc12" },
          { path: taskB, branch: "task-b", headSha: "abc1234abc1234abc1234abc1234abc1234abc12" },
          {
            path: gitOnly,
            branch: "git-only",
            headSha: "abc1234abc1234abc1234abc1234abc1234abc12",
          },
        ],
      ],
      [repoB, []],
    ]),
  );

  assert.deepEqual(await loadRepoList(undefined, listGitWorktrees), [
    {
      id: "repo-1",
      repoPath: repoA,
      mainWorktree: {
        worktreeId: toWorktreeId("repo-1", repoA),
        worktreePath: repoA,
        name: path.basename(repoA),
        branch: "main",
        headSha: null,
        headCommittedAt: undefined,
        isMainWorktree: true,
        primarySessions: [],
        suggestedSessions: [],
        activeTerminalRuntimeIds: [],
      },
      taskWorktrees: [
        {
          worktreeId: toWorktreeId("repo-1", taskA),
          worktreePath: taskA,
          name: "task-a",
          branch: "task-a",
          headSha: "abc1234abc1234abc1234abc1234abc1234abc12",
          headCommittedAt: undefined,
          primarySessions: [
            {
              provider: "codex",
              agentSessionKey: toSessionKey("codex", "codex-1"),
              activeTerminalRuntimeId: null,
              state: "inactive",
              activityState: "waiting",
              preview: "",
            },
          ],
          suggestedSessions: [],
          activeTerminalRuntimeIds: [],
        },
        {
          worktreeId: toWorktreeId("repo-1", taskB),
          worktreePath: taskB,
          name: "task-b",
          branch: "task-b",
          headSha: "abc1234abc1234abc1234abc1234abc1234abc12",
          headCommittedAt: undefined,
          primarySessions: [],
          suggestedSessions: [],
          activeTerminalRuntimeIds: [],
        },
        {
          worktreeId: toWorktreeId("repo-1", gitOnly),
          worktreePath: gitOnly,
          name: "git-only",
          branch: "git-only",
          headSha: "abc1234abc1234abc1234abc1234abc1234abc12",
          headCommittedAt: undefined,
          primarySessions: [],
          suggestedSessions: [],
          activeTerminalRuntimeIds: [],
        },
      ],
    },
    {
      id: "repo-2",
      repoPath: repoB,
      mainWorktree: {
        worktreeId: toWorktreeId("repo-2", repoB),
        worktreePath: repoB,
        name: path.basename(repoB),
        branch: "main",
        headSha: null,
        headCommittedAt: undefined,
        isMainWorktree: true,
        primarySessions: [],
        suggestedSessions: [],
        activeTerminalRuntimeIds: [],
      },
      taskWorktrees: [],
    },
  ]);
});

test("loadRepoList は main worktree を repo item に返す", async () => {
  const repoPath = path.join(tempDir, "repo-main");
  fs.mkdirSync(repoPath);
  runGit(["init"], repoPath);
  runGit(["checkout", "-B", "main"], repoPath);
  const committedAt = "2026-07-19T12:34:56+09:00";
  runGit(["commit", "--allow-empty", "-m", "init"], repoPath, {
    GIT_COMMITTER_DATE: committedAt,
  });
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [],
  });

  const result = await loadRepoList(undefined, async () => []);

  assert.equal(result[0].mainWorktree.worktreeId, toWorktreeId("repo-1", repoPath));
  assert.equal(result[0].mainWorktree.worktreePath, repoPath);
  assert.equal(result[0].mainWorktree.branch, "main");
  assert.equal(result[0].mainWorktree.headCommittedAt, Date.parse(committedAt));
  assert.equal(result[0].mainWorktree.isMainWorktree, true);
  assert.equal(result[0].mainWorktree.primarySessions[0], undefined);
  assert.deepEqual(result[0].mainWorktree.suggestedSessions, []);
});

test("loadRepoList は detached HEAD の main worktree を branch null で返す", async () => {
  const repoPath = path.join(tempDir, "repo-detached-main");
  fs.mkdirSync(repoPath);
  runGit(["init"], repoPath);
  runGit(["checkout", "-B", "main"], repoPath);
  runGit(["commit", "--allow-empty", "-m", "init"], repoPath);
  runGit(["checkout", "--detach", "HEAD"], repoPath);
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [],
  });

  const result = await loadRepoList(undefined, async () => []);

  assert.equal(result[0].mainWorktree.worktreeId, toWorktreeId("repo-1", repoPath));
  assert.equal(result[0].mainWorktree.branch, null);
  assert.match(result[0].mainWorktree.headSha, /^[0-9a-f]{40}$/);
  assert.equal(result[0].mainWorktree.isMainWorktree, true);
});

test("loadRepoList は HEAD がない main worktree も返す", async () => {
  const repoPath = path.join(tempDir, "repo-empty-main");
  fs.mkdirSync(repoPath);
  runGit(["init"], repoPath);
  runGit(["symbolic-ref", "HEAD", "refs/heads/main"], repoPath);
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [],
  });

  const result = await loadRepoList(undefined, async () => []);

  assert.equal(result[0].mainWorktree.worktreeId, toWorktreeId("repo-1", repoPath));
  assert.equal(result[0].mainWorktree.branch, "main");
  assert.equal(result[0].mainWorktree.headSha, null);
  assert.equal(result[0].mainWorktree.headCommittedAt, undefined);
  assert.equal(result[0].mainWorktree.isMainWorktree, true);
});

test("loadRepoList は Git repo ではない metadata repo を返さない", async () => {
  const repoPath = path.join(tempDir, "not-a-git-repo");
  fs.mkdirSync(repoPath);
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [],
  });

  assert.deepEqual(await loadRepoList(), []);
});

test("loadRepoList は消えた metadata repo を返さない", async () => {
  const repoPath = path.join(tempDir, "missing-git-repo");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [],
  });

  assert.deepEqual(await loadRepoList(), []);
});

test("loadRepoList は bare repo を返さない", async () => {
  const repoPath = path.join(tempDir, "bare-repo");
  fs.mkdirSync(repoPath);
  runGit(["init", "--bare"], repoPath);
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [],
  });

  assert.deepEqual(await loadRepoList(), []);
});

test("loadRepoList は valid repo の worktree list 失敗を握りつぶさない", async () => {
  const repoPath = createGitRepo("repo-list-fails");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [],
  });

  await assert.rejects(
    () =>
      loadRepoList(undefined, async () => {
        throw new Error("list failed");
      }),
    /list failed/,
  );
});

test("loadRepoList は各 primary を session key と一致する runtime の状態で返す", async () => {
  const repoPath = createGitRepo("repo-active-primary");
  const taskA = path.join(repoPath, ".yuru/worktrees/task-a");
  const taskB = path.join(repoPath, ".yuru/worktrees/task-b");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: taskA,
        primarySessions: [
          { provider: "codex", agentSessionId: "codex-1" },
          { provider: "claude", agentSessionId: "claude-2" },
        ],
      },
      {
        repoId: "repo-1",
        worktreePath: taskB,
        primarySessions: [{ provider: "claude", agentSessionId: "claude-1" }],
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        repoPath,
        [
          { path: taskA, branch: "task-a", headSha: "abc1234abc1234abc1234abc1234abc1234abc12" },
          { path: taskB, branch: "task-b", headSha: "abc1234abc1234abc1234abc1234abc1234abc12" },
        ],
      ],
    ]),
  );

  const result = await loadRepoList(
    new Map([
      [toSessionKey("codex", "codex-1"), "runtime-1"],
      [toSessionKey("claude", "claude-2"), "runtime-2"],
    ]),
    listGitWorktrees,
    new Map([
      [toSessionKey("codex", "codex-1"), "first preview"],
      [toSessionKey("claude", "claude-2"), "second preview"],
    ]),
  );
  const taskWorktrees = result[0].taskWorktrees;
  assert.equal(taskWorktrees[0].primarySessions.length, 2);
  assert.equal(taskWorktrees[0].primarySessions[0].state, "active");
  assert.equal(
    taskWorktrees[0].primarySessions[0].agentSessionKey,
    toSessionKey("codex", "codex-1"),
  );
  assert.equal(taskWorktrees[0].primarySessions[0].activeTerminalRuntimeId, "runtime-1");
  assert.equal(taskWorktrees[0].primarySessions[0].activityState, "waiting");
  assert.equal(taskWorktrees[0].primarySessions[0].preview, "first preview");
  assert.equal(taskWorktrees[0].primarySessions[1].state, "active");
  assert.equal(
    taskWorktrees[0].primarySessions[1].agentSessionKey,
    toSessionKey("claude", "claude-2"),
  );
  assert.equal(taskWorktrees[0].primarySessions[1].activeTerminalRuntimeId, "runtime-2");
  assert.equal(taskWorktrees[0].primarySessions[1].activityState, "waiting");
  assert.equal(taskWorktrees[0].primarySessions[1].preview, "second preview");
  assert.equal(taskWorktrees[1].primarySessions[0].state, "inactive");
  assert.equal(
    taskWorktrees[1].primarySessions[0].agentSessionKey,
    toSessionKey("claude", "claude-1"),
  );
  assert.equal(taskWorktrees[1].primarySessions[0].activeTerminalRuntimeId, null);
  assert.equal(taskWorktrees[1].primarySessions[0].activityState, "waiting");
  assert.equal(taskWorktrees[1].primarySessions[0].preview, "");
});

test("loadRepoList は active primary session の作業状態を返す", async () => {
  const sessionKey = toSessionKey("codex", "codex-1");
  const repoPath = createGitRepo("repo-active-primary-activity");
  const worktreePath = path.join(repoPath, ".yuru/worktrees/task-a");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath,
        primarySessions: [{ provider: "codex", agentSessionId: "codex-1" }],
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        repoPath,
        [
          {
            path: worktreePath,
            branch: "task-a",
            headSha: "abc1234abc1234abc1234abc1234abc1234abc12",
          },
        ],
      ],
    ]),
  );

  const result = await loadRepoList(
    new Map([[sessionKey, "runtime-1"]]),
    listGitWorktrees,
    undefined,
    undefined,
    undefined,
    undefined,
    new Map([["runtime-1", "working"]]),
  );

  assert.equal(result[0].taskWorktrees[0].primarySessions[0].activityState, "working");
});

test("loadRepoList は metadata primary がない worktree に active terminal runtime を合成しない", async () => {
  const repoPath = createGitRepo("repo-no-primary-active");
  const worktreePath = path.join(repoPath, ".yuru/worktrees/task-a");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath,
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        repoPath,
        [
          {
            path: worktreePath,
            branch: "task-a",
            headSha: "abc1234abc1234abc1234abc1234abc12",
          },
        ],
      ],
    ]),
  );

  const result = await loadRepoList(
    new Map([[toSessionKey("codex", "codex-1"), "runtime-1"]]),
    listGitWorktrees,
  );

  assert.equal(result[0].taskWorktrees[0].primarySessions[0], undefined);
});

test("loadRepoList は primary 未確定の active terminal runtime を worktree に重ねる", async () => {
  const repoPath = createGitRepo("repo-active-terminal");
  const worktreePath = path.join(repoPath, ".yuru/worktrees/task-a");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath,
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        repoPath,
        [
          {
            path: worktreePath,
            branch: "task-a",
            headSha: "abc1234abc1234abc1234abc1234abc1234abc12",
          },
        ],
      ],
    ]),
  );

  const result = await loadRepoList(
    undefined,
    listGitWorktrees,
    undefined,
    undefined,
    new Map([
      [
        path.resolve(worktreePath),
        {
          provider: "codex",
          terminalRuntimeId: "runtime-1",
        },
      ],
    ]),
  );

  assert.deepEqual(result[0].taskWorktrees[0].primarySessions[0], {
    provider: "codex",
    agentSessionKey: null,
    activeTerminalRuntimeId: "runtime-1",
    state: "active",
    activityState: "waiting",
    preview: "",
  });
});

test("loadRepoList は primary session の preview を返す", async () => {
  const repoPath = createGitRepo("repo-primary-preview");
  const worktreePath = path.join(repoPath, ".yuru/worktrees/task-a");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath,
        primarySessions: [{ provider: "codex", agentSessionId: "codex-1" }],
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        repoPath,
        [
          {
            path: worktreePath,
            branch: "task-a",
            headSha: "abc1234abc1234abc1234abc1234abc12",
          },
        ],
      ],
    ]),
  );

  const result = await loadRepoList(
    undefined,
    listGitWorktrees,
    new Map([[toSessionKey("codex", "codex-1"), "preview text"]]),
  );

  assert.equal(result[0].taskWorktrees[0].primarySessions[0].preview, "preview text");
});

test("loadRepoList は worktree branch の GitHub PR を返す", async () => {
  const repoPath = createGitRepo("repo-github-pr");
  const taskA = path.join(repoPath, ".yuru/worktrees/task-a");
  const taskB = path.join(repoPath, ".yuru/worktrees/task-b");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        repoPath,
        [
          { path: taskA, branch: "task-a", headSha: "abc1234abc1234abc1234abc1234abc12" },
          { path: taskB, branch: "task-b", headSha: "abc1234abc1234abc1234abc1234abc12" },
        ],
      ],
    ]),
  );
  const pullRequest = {
    prNumber: 42,
    state: "open",
    url: "https://github.com/jinjor/yuru/pull/42",
  };
  const requestedLookups = [];

  const result = await loadRepoList(
    undefined,
    listGitWorktrees,
    undefined,
    undefined,
    undefined,
    (requestedRepoPath, branch, headSha) => {
      requestedLookups.push([requestedRepoPath, branch, headSha]);
      return branch === "task-a" ? pullRequest : null;
    },
  );

  assert.deepEqual(requestedLookups, [
    [repoPath, "task-a", "abc1234abc1234abc1234abc1234abc12"],
    [repoPath, "task-b", "abc1234abc1234abc1234abc1234abc12"],
  ]);
  assert.equal(result[0].mainWorktree.githubPullRequest, undefined);
  assert.deepEqual(result[0].taskWorktrees[0].githubPullRequest, pullRequest);
  assert.equal(result[0].taskWorktrees[1].githubPullRequest, null);
});

test("loadRepoList は suggested worktree session を返す", async () => {
  const repoPath = createGitRepo("repo-suggested-session");
  const worktreePath = path.join(repoPath, ".yuru/worktrees/task-a");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath,
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        repoPath,
        [
          {
            path: worktreePath,
            branch: "task-a",
            headSha: "abc1234abc1234abc1234abc1234abc12",
          },
        ],
      ],
    ]),
  );

  const result = await loadRepoList(
    undefined,
    listGitWorktrees,
    new Map([[toSessionKey("claude", "claude-1"), "suggested preview"]]),
    async (worktreePaths) =>
      new Map([
        [
          worktreePaths[0],
          [
            {
              provider: "claude",
              agentSessionId: "claude-1",
            },
          ],
        ],
      ]),
  );

  assert.deepEqual(result[0].taskWorktrees[0].suggestedSessions, [
    {
      provider: "claude",
      agentSessionKey: toSessionKey("claude", "claude-1"),
      activeTerminalRuntimeId: null,
      state: "inactive",
      activityState: "waiting",
      preview: "suggested preview",
      timestamp: 0,
    },
  ]);
});

test("loadRepoList は active session key と一致する suggested を active として返す", async () => {
  const repoPath = createGitRepo("repo-active-suggested");
  const worktreePath = path.join(repoPath, ".yuru/worktrees/task-a");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath,
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        repoPath,
        [
          {
            path: worktreePath,
            branch: "task-a",
            headSha: "abc1234abc1234abc1234abc1234abc12",
          },
        ],
      ],
    ]),
  );

  const result = await loadRepoList(
    new Map([[toSessionKey("claude", "claude-1"), "runtime-1"]]),
    listGitWorktrees,
    new Map([[toSessionKey("claude", "claude-1"), "suggested preview"]]),
    async (worktreePaths) =>
      new Map([
        [
          worktreePaths[0],
          [
            {
              provider: "claude",
              agentSessionId: "claude-1",
            },
          ],
        ],
      ]),
  );

  assert.deepEqual(result[0].taskWorktrees[0].suggestedSessions, [
    {
      provider: "claude",
      agentSessionKey: toSessionKey("claude", "claude-1"),
      activeTerminalRuntimeId: "runtime-1",
      state: "active",
      activityState: "waiting",
      preview: "suggested preview",
      timestamp: 0,
    },
  ]);
});

test("loadRepoList は複数の active suggested session をそれぞれ active として返す", async () => {
  const codexSessionKey = toSessionKey("codex", "codex-1");
  const claudeSessionKey = toSessionKey("claude", "claude-1");
  const repoPath = createGitRepo("repo-multiple-active-suggested");
  const worktreePath = path.join(repoPath, ".yuru/worktrees/task-a");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath,
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        repoPath,
        [
          {
            path: worktreePath,
            branch: "task-a",
            headSha: "abc1234abc1234abc1234abc1234abc12",
          },
        ],
      ],
    ]),
  );

  const result = await loadRepoList(
    new Map([
      [codexSessionKey, "runtime-codex"],
      [claudeSessionKey, "runtime-claude"],
    ]),
    listGitWorktrees,
    undefined,
    async (worktreePaths) =>
      new Map([
        [
          worktreePaths[0],
          [
            {
              provider: "codex",
              agentSessionId: "codex-1",
            },
            {
              provider: "claude",
              agentSessionId: "claude-1",
            },
          ],
        ],
      ]),
  );

  assert.deepEqual(result[0].taskWorktrees[0].suggestedSessions, [
    {
      provider: "codex",
      agentSessionKey: codexSessionKey,
      activeTerminalRuntimeId: "runtime-codex",
      state: "active",
      activityState: "waiting",
      preview: "",
      timestamp: 0,
    },
    {
      provider: "claude",
      agentSessionKey: claudeSessionKey,
      activeTerminalRuntimeId: "runtime-claude",
      state: "active",
      activityState: "waiting",
      preview: "",
      timestamp: 0,
    },
  ]);
});

test("loadRepoList は全 primary と同じ session を suggested から除外する", async () => {
  const repoPath = createGitRepo("repo-primary-excludes-suggested");
  const worktreePath = path.join(repoPath, ".yuru/worktrees/task-a");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath,
        primarySessions: [
          { provider: "claude", agentSessionId: "claude-1" },
          { provider: "codex", agentSessionId: "codex-1" },
        ],
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        repoPath,
        [
          {
            path: worktreePath,
            branch: "task-a",
            headSha: "abc1234abc1234abc1234abc1234abc12",
          },
        ],
      ],
    ]),
  );

  const result = await loadRepoList(
    undefined,
    listGitWorktrees,
    undefined,
    async (worktreePaths) =>
      new Map([
        [
          worktreePaths[0],
          [
            {
              provider: "claude",
              agentSessionId: "claude-1",
            },
            {
              provider: "codex",
              agentSessionId: "codex-1",
            },
            {
              provider: "kimi",
              agentSessionId: "kimi-1",
            },
          ],
        ],
      ]),
  );

  assert.deepEqual(result[0].taskWorktrees[0].suggestedSessions, [
    {
      provider: "kimi",
      agentSessionKey: toSessionKey("kimi", "kimi-1"),
      activeTerminalRuntimeId: null,
      state: "inactive",
      activityState: "waiting",
      preview: "",
      timestamp: 0,
    },
  ]);
});

test("loadRepoList は suggested worktree session を並び替えずに返す", async () => {
  const repoPath = createGitRepo("repo-suggested-order");
  const worktreePath = path.join(repoPath, ".yuru/worktrees/task-a");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        repoPath,
        [
          {
            path: worktreePath,
            branch: "task-a",
            headSha: "abc1234abc1234abc1234abc1234abc12",
          },
        ],
      ],
    ]),
  );

  const result = await loadRepoList(
    undefined,
    listGitWorktrees,
    undefined,
    async (worktreePaths) =>
      new Map([
        [
          worktreePaths[0],
          [
            {
              provider: "claude",
              agentSessionId: "claude-b",
            },
            {
              provider: "claude",
              agentSessionId: "claude-a",
            },
          ],
        ],
      ]),
  );

  assert.deepEqual(
    result[0].taskWorktrees[0].suggestedSessions.map((session) => session.agentSessionKey),
    [toSessionKey("claude", "claude-b"), toSessionKey("claude", "claude-a")],
  );
});

test("cleanupStaleTaskWorktrees は list に成功した repo の stale task worktree を削除する", async () => {
  seed({
    repos: [
      { id: "repo-1", repoPath: "/tmp/repo-a" },
      { id: "repo-2", repoPath: "/tmp/repo-b" },
    ],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/worktrees/keep/.",
        primarySessions: [{ provider: "codex", agentSessionId: "codex-1" }],
      },
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/worktrees/stale",
        primarySessions: [{ provider: "claude", agentSessionId: "claude-1" }],
      },
      {
        repoId: "repo-2",
        worktreePath: "/tmp/repo-b/worktrees/stale",
        primarySessions: [],
      },
      {
        repoId: "unknown-repo",
        worktreePath: "/tmp/unknown/worktrees/stale",
        primarySessions: [],
      },
    ],
  });

  const result = await cleanupStaleTaskWorktrees(async (repoPath) => {
    if (repoPath === "/tmp/repo-a") {
      return [
        {
          path: "/tmp/repo-a/worktrees/keep",
          branch: "keep",
          headSha: "abc1234abc1234abc1234abc1234abc1234abc12",
        },
      ];
    }
    throw new Error("cannot list worktrees");
  });

  assert.equal(result.removedTaskWorktreeCount, 1);
  assert.deepEqual(
    result.skippedRepos.map(({ repoId, repoPath }) => ({ repoId, repoPath })),
    [{ repoId: "repo-2", repoPath: "/tmp/repo-b" }],
  );
  assert.equal(result.skippedRepos[0].error instanceof Error, true);
  assert.deepEqual(loadMetadata(), {
    repos: [
      { id: "repo-1", repoPath: "/tmp/repo-a" },
      { id: "repo-2", repoPath: "/tmp/repo-b" },
    ],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/worktrees/keep/.",
        primarySessions: [{ provider: "codex", agentSessionId: "codex-1" }],
      },
      {
        repoId: "repo-2",
        worktreePath: "/tmp/repo-b/worktrees/stale",
        primarySessions: [],
      },
      {
        repoId: "unknown-repo",
        worktreePath: "/tmp/unknown/worktrees/stale",
        primarySessions: [],
      },
    ],
  });
});

test("cleanupStaleTaskWorktrees は list に失敗した repo の metadata を変更しない", async () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo-a" }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/worktrees/stale",
        primarySessions: [{ provider: "claude", agentSessionId: "claude-1" }],
      },
    ],
  });

  const result = await cleanupStaleTaskWorktrees(async () => {
    throw new Error("cannot list worktrees");
  });

  assert.equal(result.removedTaskWorktreeCount, 0);
  assert.deepEqual(
    result.skippedRepos.map(({ repoId, repoPath }) => ({ repoId, repoPath })),
    [{ repoId: "repo-1", repoPath: "/tmp/repo-a" }],
  );
  assert.equal(result.skippedRepos[0].error instanceof Error, true);
  assert.deepEqual(loadMetadata().taskWorktrees, [
    {
      repoId: "repo-1",
      worktreePath: "/tmp/repo-a/worktrees/stale",
      primarySessions: [{ provider: "claude", agentSessionId: "claude-1" }],
    },
  ]);
});

test("upsertTaskWorktree は新規登録する", () => {
  seed({ repos: [{ id: "repo-1", repoPath: "/tmp/repo" }], taskWorktrees: [] });
  upsertTaskWorktree("repo-1", "/tmp/wt");

  const taskWorktrees = loadMetadata().taskWorktrees;
  assert.equal(taskWorktrees.length, 1);
  assert.equal(taskWorktrees[0].repoId, "repo-1");
  assert.equal(taskWorktrees[0].worktreePath, "/tmp/wt");
  assert.deepEqual(taskWorktrees[0].primarySessions, []);
});

test("upsertTaskWorktree は同一 path を二重登録しない", () => {
  seed({ repos: [], taskWorktrees: [] });
  upsertTaskWorktree("repo-1", "/tmp/wt");
  upsertTaskWorktree("repo-2", "/tmp/wt");

  const taskWorktrees = loadMetadata().taskWorktrees;
  assert.equal(taskWorktrees.length, 1);
  assert.equal(taskWorktrees[0].repoId, "repo-2");
  assert.equal(taskWorktrees[0].worktreePath, "/tmp/wt");
});

test("attachPrimarySessionByPath は既存 primary を残して末尾へ追加し新形式で書く", () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo" }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/wt",
        primarySession: { provider: "codex", agentSessionId: "original" },
      },
    ],
  });

  attachPrimarySessionByPath("/tmp/wt", { provider: "claude", agentSessionId: "abc" });

  assert.deepEqual(loadMetadata().taskWorktrees[0].primarySessions, [
    { provider: "codex", agentSessionId: "original" },
    { provider: "claude", agentSessionId: "abc" },
  ]);
  const written = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  assert.equal("primarySession" in written.taskWorktrees[0], false);
  assert.deepEqual(written.taskWorktrees[0].primarySessions, [
    { provider: "codex", agentSessionId: "original" },
    { provider: "claude", agentSessionId: "abc" },
  ]);
});

test("attachPrimarySessionByPath は同じ provider session を二重追加しない", () => {
  seed({
    repos: [],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/wt",
        primarySessions: [{ provider: "claude", agentSessionId: "abc" }],
      },
    ],
  });

  attachPrimarySessionByPath("/tmp/wt", { provider: "claude", agentSessionId: "abc" });

  assert.deepEqual(loadMetadata().taskWorktrees[0].primarySessions, [
    { provider: "claude", agentSessionId: "abc" },
  ]);
});

test("attachPrimarySessionByPath は同じ provider session を別の worktree から外す", () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo" }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/wt-a",
        primarySessions: [
          { provider: "codex", agentSessionId: "keep-a" },
          { provider: "claude", agentSessionId: "abc" },
        ],
      },
      {
        repoId: "repo-1",
        worktreePath: "/tmp/wt-b",
        primarySessions: [{ provider: "kimi", agentSessionId: "keep-b" }],
      },
    ],
  });

  attachPrimarySessionByPath("/tmp/wt-b", { provider: "claude", agentSessionId: "abc" });

  const taskWorktrees = loadMetadata().taskWorktrees;
  const a = taskWorktrees.find((entry) => entry.worktreePath === "/tmp/wt-a");
  const b = taskWorktrees.find((entry) => entry.worktreePath === "/tmp/wt-b");
  assert.deepEqual(a.primarySessions, [{ provider: "codex", agentSessionId: "keep-a" }]);
  assert.deepEqual(b.primarySessions, [
    { provider: "kimi", agentSessionId: "keep-b" },
    { provider: "claude", agentSessionId: "abc" },
  ]);
});

test("attachPrimarySessionByPath は対象 path が無ければ何もしない", () => {
  seed({ repos: [], taskWorktrees: [] });
  attachPrimarySessionByPath("/tmp/missing", { provider: "claude", agentSessionId: "abc" });
  assert.deepEqual(loadMetadata().taskWorktrees, []);
});

test("detachPrimarySessionByPath は一致する primary だけを外す", () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo" }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/wt-a",
        primarySessions: [
          { provider: "claude", agentSessionId: "abc" },
          { provider: "codex", agentSessionId: "keep" },
        ],
      },
      {
        repoId: "repo-1",
        worktreePath: "/tmp/wt-b",
        primarySessions: [{ provider: "claude", agentSessionId: "def" }],
      },
    ],
  });

  detachPrimarySessionByPath("/tmp/wt-a", { provider: "claude", agentSessionId: "abc" });

  const taskWorktrees = loadMetadata().taskWorktrees;
  const a = taskWorktrees.find((entry) => entry.worktreePath === "/tmp/wt-a");
  const b = taskWorktrees.find((entry) => entry.worktreePath === "/tmp/wt-b");
  // strong link だけが消え、task worktree の record 自体は残る
  assert.deepEqual(a.primarySessions, [{ provider: "codex", agentSessionId: "keep" }]);
  assert.deepEqual(b.primarySessions, [{ provider: "claude", agentSessionId: "def" }]);
});

test("detachPrimarySessionByPath は provider や session id が違えば外さない", () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo" }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/wt",
        primarySessions: [{ provider: "claude", agentSessionId: "abc" }],
      },
    ],
  });

  detachPrimarySessionByPath("/tmp/wt", { provider: "codex", agentSessionId: "abc" });
  detachPrimarySessionByPath("/tmp/wt", { provider: "claude", agentSessionId: "other" });

  assert.deepEqual(loadMetadata().taskWorktrees[0].primarySessions, [
    { provider: "claude", agentSessionId: "abc" },
  ]);
});

test("removeTaskWorktreeByPath は対象だけ削除する", () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo" }],
    taskWorktrees: [
      { repoId: "repo-1", worktreePath: "/tmp/wt-a" },
      { repoId: "repo-1", worktreePath: "/tmp/wt-b" },
    ],
  });

  removeTaskWorktreeByPath("/tmp/wt-a");

  const taskWorktrees = loadMetadata().taskWorktrees;
  assert.equal(taskWorktrees.length, 1);
  assert.equal(taskWorktrees[0].worktreePath, "/tmp/wt-b");
});
