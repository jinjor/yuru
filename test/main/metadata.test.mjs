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
  findRepoByPath,
  loadMetadata,
  parseMetadata,
  removeTaskWorktreeByPath,
  upsertTaskWorktree,
} = await import("../../src/main/metadata.ts");
const { loadRepoList } = await import("../../src/main/repo-list.ts");
const { cleanupStaleTaskWorktrees } = await import("../../src/main/task-worktree-maintenance.ts");
const { toWorktreeId } = await import("../../src/main/worktree-identity.ts");
const { toSessionKey } = await import("../../src/shared/session.ts");

function reset() {
  fs.rmSync(metadataPath, { force: true });
}

function seed(metadata) {
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

function listGitWorktreesFrom(worktreesByRepoPath) {
  return async (repoPath) => worktreesByRepoPath.get(repoPath) ?? [];
}

function runGit(args, cwd) {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Yuru Test",
      GIT_AUTHOR_EMAIL: "yuru@example.test",
      GIT_COMMITTER_NAME: "Yuru Test",
      GIT_COMMITTER_EMAIL: "yuru@example.test",
    },
  });
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

test("parseMetadata は taskWorktrees の primarySession を読み取る", () => {
  const result = parseMetadata({
    repos: [],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/wt",
        primarySession: { provider: "claude", providerSessionId: "abc" },
      },
    ],
  });
  assert.deepEqual(result.taskWorktrees[0].primarySession, {
    provider: "claude",
    providerSessionId: "abc",
  });
});

test("parseMetadata は不正な provider を弾く", () => {
  assert.throws(() =>
    parseMetadata({
      repos: [],
      taskWorktrees: [
        {
          repoId: "repo-1",
          worktreePath: "/tmp/wt",
          primarySession: { provider: "unknown", providerSessionId: "abc" },
        },
      ],
    }),
  );
});

test("parseMetadata は型違いの repos を弾く", () => {
  assert.throws(() => parseMetadata({ repos: "not-array" }));
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
        primarySession: { provider: "codex", providerSessionId: "codex-1" },
      },
      {
        repoId: "repo-1",
        worktreePath: taskB,
      },
      {
        repoId: "repo-1",
        worktreePath: missingTask,
        primarySession: { provider: "claude", providerSessionId: "claude-1" },
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
          { path: gitOnly, branch: "git-only", headSha: "abc1234abc1234abc1234abc1234abc1234abc12" },
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
        isMainWorktree: true,
        primarySession: undefined,
        suggestedSessions: [],
      },
      taskWorktrees: [
        {
          worktreeId: toWorktreeId("repo-1", taskA),
          worktreePath: taskA,
          name: "task-a",
          branch: "task-a",
          headSha: "abc1234abc1234abc1234abc1234abc1234abc12",
          primarySession: {
            provider: "codex",
            providerSessionKey: toSessionKey("codex", "codex-1"),
            activeTerminalRuntimeId: null,
            state: "inactive",
            activityState: "waiting",
            preview: "",
          },
          suggestedSessions: [],
        },
        {
          worktreeId: toWorktreeId("repo-1", taskB),
          worktreePath: taskB,
          name: "task-b",
          branch: "task-b",
          headSha: "abc1234abc1234abc1234abc1234abc1234abc12",
          primarySession: undefined,
          suggestedSessions: [],
        },
        {
          worktreeId: toWorktreeId("repo-1", gitOnly),
          worktreePath: gitOnly,
          name: "git-only",
          branch: "git-only",
          headSha: "abc1234abc1234abc1234abc1234abc1234abc12",
          primarySession: undefined,
          suggestedSessions: [],
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
        isMainWorktree: true,
        primarySession: undefined,
        suggestedSessions: [],
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
  runGit(["commit", "--allow-empty", "-m", "init"], repoPath);
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [],
  });

  const result = await loadRepoList(undefined, async () => []);

  assert.equal(result[0].mainWorktree.worktreeId, toWorktreeId("repo-1", repoPath));
  assert.equal(result[0].mainWorktree.worktreePath, repoPath);
  assert.equal(result[0].mainWorktree.branch, "main");
  assert.equal(result[0].mainWorktree.isMainWorktree, true);
  assert.equal(result[0].mainWorktree.primarySession, undefined);
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

test("loadRepoList は active session key と一致する primary を active として返す", async () => {
  const repoPath = createGitRepo("repo-active-primary");
  const taskA = path.join(repoPath, ".yuru/worktrees/task-a");
  const taskB = path.join(repoPath, ".yuru/worktrees/task-b");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: taskA,
        primarySession: { provider: "codex", providerSessionId: "codex-1" },
      },
      {
        repoId: "repo-1",
        worktreePath: taskB,
        primarySession: { provider: "claude", providerSessionId: "claude-1" },
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
    new Map([[toSessionKey("codex", "codex-1"), "runtime-1"]]),
    listGitWorktrees,
  );
  const taskWorktrees = result[0].taskWorktrees;
  assert.equal(taskWorktrees[0].primarySession.state, "active");
  assert.equal(taskWorktrees[0].primarySession.providerSessionKey, toSessionKey("codex", "codex-1"));
  assert.equal(taskWorktrees[0].primarySession.activeTerminalRuntimeId, "runtime-1");
  assert.equal(taskWorktrees[0].primarySession.activityState, "waiting");
  assert.equal(taskWorktrees[0].primarySession.preview, "");
  assert.equal(taskWorktrees[1].primarySession.state, "inactive");
  assert.equal(taskWorktrees[1].primarySession.providerSessionKey, toSessionKey("claude", "claude-1"));
  assert.equal(taskWorktrees[1].primarySession.activeTerminalRuntimeId, null);
  assert.equal(taskWorktrees[1].primarySession.activityState, "waiting");
  assert.equal(taskWorktrees[1].primarySession.preview, "");
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
        primarySession: { provider: "codex", providerSessionId: "codex-1" },
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

  assert.equal(result[0].taskWorktrees[0].primarySession.activityState, "working");
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

  assert.equal(result[0].taskWorktrees[0].primarySession, undefined);
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
        [{ path: worktreePath, branch: "task-a", headSha: "abc1234abc1234abc1234abc1234abc1234abc12" }],
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

  assert.deepEqual(result[0].taskWorktrees[0].primarySession, {
    provider: "codex",
    providerSessionKey: null,
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
        primarySession: { provider: "codex", providerSessionId: "codex-1" },
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

  assert.equal(result[0].taskWorktrees[0].primarySession.preview, "preview text");
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
  const loadedBranches = [];

  const result = await loadRepoList(
    undefined,
    listGitWorktrees,
    undefined,
    undefined,
    undefined,
    async (_repoPath, branch) => {
      loadedBranches.push(branch);
      return branch === "task-a" ? pullRequest : null;
    },
  );

  assert.deepEqual(loadedBranches, ["task-a", "task-b"]);
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
              providerSessionId: "claude-1",
            },
          ],
        ],
      ]),
  );

  assert.deepEqual(result[0].taskWorktrees[0].suggestedSessions, [
    {
      provider: "claude",
      providerSessionKey: toSessionKey("claude", "claude-1"),
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
              providerSessionId: "claude-1",
            },
          ],
        ],
      ]),
  );

  assert.deepEqual(result[0].taskWorktrees[0].suggestedSessions, [
    {
      provider: "claude",
      providerSessionKey: toSessionKey("claude", "claude-1"),
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
              providerSessionId: "codex-1",
            },
            {
              provider: "claude",
              providerSessionId: "claude-1",
            },
          ],
        ],
      ]),
  );

  assert.deepEqual(result[0].taskWorktrees[0].suggestedSessions, [
    {
      provider: "codex",
      providerSessionKey: codexSessionKey,
      activeTerminalRuntimeId: "runtime-codex",
      state: "active",
      activityState: "waiting",
      preview: "",
      timestamp: 0,
    },
    {
      provider: "claude",
      providerSessionKey: claudeSessionKey,
      activeTerminalRuntimeId: "runtime-claude",
      state: "active",
      activityState: "waiting",
      preview: "",
      timestamp: 0,
    },
  ]);
});

test("loadRepoList は primary と同じ session を suggested から除外する", async () => {
  const repoPath = createGitRepo("repo-primary-excludes-suggested");
  const worktreePath = path.join(repoPath, ".yuru/worktrees/task-a");
  seed({
    repos: [{ id: "repo-1", repoPath }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath,
        primarySession: { provider: "claude", providerSessionId: "claude-1" },
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
              providerSessionId: "claude-1",
            },
          ],
        ],
      ]),
  );

  assert.deepEqual(result[0].taskWorktrees[0].suggestedSessions, []);
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
              providerSessionId: "claude-b",
            },
            {
              provider: "claude",
              providerSessionId: "claude-a",
            },
          ],
        ],
      ]),
  );

  assert.deepEqual(
    result[0].taskWorktrees[0].suggestedSessions.map((session) => session.providerSessionKey),
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
        primarySession: { provider: "codex", providerSessionId: "codex-1" },
      },
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/worktrees/stale",
        primarySession: { provider: "claude", providerSessionId: "claude-1" },
      },
      {
        repoId: "repo-2",
        worktreePath: "/tmp/repo-b/worktrees/stale",
      },
      {
        repoId: "unknown-repo",
        worktreePath: "/tmp/unknown/worktrees/stale",
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
  assert.deepEqual(result.skippedRepos.map(({ repoId, repoPath }) => ({ repoId, repoPath })), [
    { repoId: "repo-2", repoPath: "/tmp/repo-b" },
  ]);
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
        primarySession: { provider: "codex", providerSessionId: "codex-1" },
      },
      {
        repoId: "repo-2",
        worktreePath: "/tmp/repo-b/worktrees/stale",
      },
      {
        repoId: "unknown-repo",
        worktreePath: "/tmp/unknown/worktrees/stale",
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
        primarySession: { provider: "claude", providerSessionId: "claude-1" },
      },
    ],
  });

  const result = await cleanupStaleTaskWorktrees(async () => {
    throw new Error("cannot list worktrees");
  });

  assert.equal(result.removedTaskWorktreeCount, 0);
  assert.deepEqual(result.skippedRepos.map(({ repoId, repoPath }) => ({ repoId, repoPath })), [
    { repoId: "repo-1", repoPath: "/tmp/repo-a" },
  ]);
  assert.equal(result.skippedRepos[0].error instanceof Error, true);
  assert.deepEqual(loadMetadata().taskWorktrees, [
    {
      repoId: "repo-1",
      worktreePath: "/tmp/repo-a/worktrees/stale",
      primarySession: { provider: "claude", providerSessionId: "claude-1" },
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

test("attachPrimarySessionByPath は path で primary を付ける", () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo" }],
    taskWorktrees: [{ repoId: "repo-1", worktreePath: "/tmp/wt" }],
  });

  attachPrimarySessionByPath("/tmp/wt", { provider: "claude", providerSessionId: "abc" });

  assert.deepEqual(loadMetadata().taskWorktrees[0].primarySession, {
    provider: "claude",
    providerSessionId: "abc",
  });
});

test("attachPrimarySessionByPath は同じ provider session を別の worktree から外す", () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo" }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/wt-a",
        primarySession: { provider: "claude", providerSessionId: "abc" },
      },
      { repoId: "repo-1", worktreePath: "/tmp/wt-b" },
    ],
  });

  attachPrimarySessionByPath("/tmp/wt-b", { provider: "claude", providerSessionId: "abc" });

  const taskWorktrees = loadMetadata().taskWorktrees;
  const a = taskWorktrees.find((entry) => entry.worktreePath === "/tmp/wt-a");
  const b = taskWorktrees.find((entry) => entry.worktreePath === "/tmp/wt-b");
  assert.equal(a.primarySession, undefined);
  assert.deepEqual(b.primarySession, { provider: "claude", providerSessionId: "abc" });
});

test("attachPrimarySessionByPath は対象 path が無ければ何もしない", () => {
  seed({ repos: [], taskWorktrees: [] });
  attachPrimarySessionByPath("/tmp/missing", { provider: "claude", providerSessionId: "abc" });
  assert.deepEqual(loadMetadata().taskWorktrees, []);
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
