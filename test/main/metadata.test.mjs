import assert from "node:assert/strict";
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
  loadRepoList,
  parseMetadata,
  removeTaskWorktreeByPath,
  toWorktreeId,
  upsertTaskWorktree,
} = await import("../../src/main/metadata.ts");
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
  seed({
    repos: [
      { id: "repo-1", repoPath: "/tmp/repo-a" },
      { id: "repo-2", repoPath: "/tmp/repo-b" },
    ],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/.yuru/worktrees/task-a",
        primarySession: { provider: "codex", providerSessionId: "codex-1" },
      },
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/.yuru/worktrees/task-b",
      },
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/.yuru/worktrees/missing-task",
        primarySession: { provider: "claude", providerSessionId: "claude-1" },
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        "/tmp/repo-a",
        [
          { path: "/tmp/repo-a/.yuru/worktrees/task-a", branch: "task-a" },
          { path: "/tmp/repo-a/.yuru/worktrees/task-b", branch: "task-b" },
          { path: "/tmp/repo-a/.yuru/worktrees/git-only", branch: "git-only" },
        ],
      ],
      ["/tmp/repo-b", []],
    ]),
  );

  assert.deepEqual(await loadRepoList(undefined, listGitWorktrees), [
    {
      id: "repo-1",
      repoPath: "/tmp/repo-a",
      taskWorktrees: [
        {
          worktreeId: toWorktreeId("repo-1", "/tmp/repo-a/.yuru/worktrees/task-a"),
          worktreePath: "/tmp/repo-a/.yuru/worktrees/task-a",
          name: "task-a",
          primarySession: {
            provider: "codex",
            providerSessionKey: toSessionKey("codex", "codex-1"),
            activeRuntimeSessionId: null,
            state: "inactive",
            preview: "",
          },
          suggestedSessions: [],
        },
        {
          worktreeId: toWorktreeId("repo-1", "/tmp/repo-a/.yuru/worktrees/task-b"),
          worktreePath: "/tmp/repo-a/.yuru/worktrees/task-b",
          name: "task-b",
          primarySession: undefined,
          suggestedSessions: [],
        },
        {
          worktreeId: toWorktreeId("repo-1", "/tmp/repo-a/.yuru/worktrees/git-only"),
          worktreePath: "/tmp/repo-a/.yuru/worktrees/git-only",
          name: "git-only",
          primarySession: undefined,
          suggestedSessions: [],
        },
      ],
    },
    {
      id: "repo-2",
      repoPath: "/tmp/repo-b",
      taskWorktrees: [],
    },
  ]);
});

test("loadRepoList は active session key と一致する primary を active として返す", async () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo-a" }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/.yuru/worktrees/task-a",
        primarySession: { provider: "codex", providerSessionId: "codex-1" },
      },
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/.yuru/worktrees/task-b",
        primarySession: { provider: "claude", providerSessionId: "claude-1" },
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        "/tmp/repo-a",
        [
          { path: "/tmp/repo-a/.yuru/worktrees/task-a", branch: "task-a" },
          { path: "/tmp/repo-a/.yuru/worktrees/task-b", branch: "task-b" },
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
  assert.equal(taskWorktrees[0].primarySession.activeRuntimeSessionId, "runtime-1");
  assert.equal(taskWorktrees[0].primarySession.preview, "");
  assert.equal(taskWorktrees[1].primarySession.state, "inactive");
  assert.equal(taskWorktrees[1].primarySession.providerSessionKey, toSessionKey("claude", "claude-1"));
  assert.equal(taskWorktrees[1].primarySession.activeRuntimeSessionId, null);
  assert.equal(taskWorktrees[1].primarySession.preview, "");
});

test("loadRepoList は metadata primary がなくても active runtime session を primary として返す", async () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo-a" }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/.yuru/worktrees/task-a",
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        "/tmp/repo-a",
        [{ path: "/tmp/repo-a/.yuru/worktrees/task-a", branch: "task-a" }],
      ],
    ]),
  );

  const result = await loadRepoList(
    undefined,
    listGitWorktrees,
    undefined,
    new Map([
      [
        path.resolve("/tmp/repo-a/.yuru/worktrees/task-a"),
        {
          runtimeSessionId: "runtime-1",
          provider: "codex",
          providerSessionId: null,
        },
      ],
    ]),
  );

  assert.deepEqual(result[0].taskWorktrees[0].primarySession, {
    provider: "codex",
    providerSessionKey: null,
    activeRuntimeSessionId: "runtime-1",
    state: "active",
    preview: "",
  });
});

test("loadRepoList は primary session の preview を返す", async () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo-a" }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/.yuru/worktrees/task-a",
        primarySession: { provider: "codex", providerSessionId: "codex-1" },
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        "/tmp/repo-a",
        [{ path: "/tmp/repo-a/.yuru/worktrees/task-a", branch: "task-a" }],
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

test("loadRepoList は suggested worktree session を返す", async () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo-a" }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/.yuru/worktrees/task-a",
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        "/tmp/repo-a",
        [{ path: "/tmp/repo-a/.yuru/worktrees/task-a", branch: "task-a" }],
      ],
    ]),
  );

  const result = await loadRepoList(
    undefined,
    listGitWorktrees,
    new Map([[toSessionKey("claude", "claude-1"), "suggested preview"]]),
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

  assert.deepEqual(result[0].taskWorktrees[0].suggestedSessions, [
    {
      provider: "claude",
      providerSessionKey: toSessionKey("claude", "claude-1"),
      preview: "suggested preview",
    },
  ]);
});

test("loadRepoList は primary と同じ session を suggested から除外する", async () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo-a" }],
    taskWorktrees: [
      {
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/.yuru/worktrees/task-a",
        primarySession: { provider: "claude", providerSessionId: "claude-1" },
      },
    ],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        "/tmp/repo-a",
        [{ path: "/tmp/repo-a/.yuru/worktrees/task-a", branch: "task-a" }],
      ],
    ]),
  );

  const result = await loadRepoList(
    undefined,
    listGitWorktrees,
    undefined,
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
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo-a" }],
    taskWorktrees: [],
  });
  const listGitWorktrees = listGitWorktreesFrom(
    new Map([
      [
        "/tmp/repo-a",
        [{ path: "/tmp/repo-a/.yuru/worktrees/task-a", branch: "task-a" }],
      ],
    ]),
  );

  const result = await loadRepoList(
    undefined,
    listGitWorktrees,
    undefined,
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
