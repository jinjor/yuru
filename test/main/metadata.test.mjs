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
  attachPrimarySession,
  findRepoByPath,
  loadMetadata,
  loadRepoList,
  parseMetadata,
  removeTaskWorktreeByPath,
  upsertTaskWorktree,
} = await import("../../src/main/metadata.ts");

function reset() {
  fs.rmSync(metadataPath, { force: true });
}

function seed(metadata) {
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
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
        taskWorktreeId: "wt-1",
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
          taskWorktreeId: "wt-1",
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

test("loadRepoList は repo 配下の task worktree と primary 状態を返す", () => {
  seed({
    repos: [
      { id: "repo-1", repoPath: "/tmp/repo-a" },
      { id: "repo-2", repoPath: "/tmp/repo-b" },
    ],
    taskWorktrees: [
      {
        taskWorktreeId: "wt-1",
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/.yuru/worktrees/task-a",
        primarySession: { provider: "codex", providerSessionId: "codex-1" },
      },
      {
        taskWorktreeId: "wt-2",
        repoId: "repo-1",
        worktreePath: "/tmp/repo-a/.yuru/worktrees/task-b",
      },
      {
        taskWorktreeId: "wt-3",
        repoId: "missing-repo",
        worktreePath: "/tmp/missing/task-c",
        primarySession: { provider: "claude", providerSessionId: "claude-1" },
      },
    ],
  });

  assert.deepEqual(loadRepoList(), [
    {
      id: "repo-1",
      repoPath: "/tmp/repo-a",
      taskWorktrees: [
        {
          taskWorktreeId: "wt-1",
          worktreePath: "/tmp/repo-a/.yuru/worktrees/task-a",
          name: "task-a",
          primarySession: { provider: "codex", providerSessionId: "codex-1" },
          suggestedSessions: [],
        },
        {
          taskWorktreeId: "wt-2",
          worktreePath: "/tmp/repo-a/.yuru/worktrees/task-b",
          name: "task-b",
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

test("upsertTaskWorktree は指定した ID で新規登録する", () => {
  seed({ repos: [{ id: "repo-1", repoPath: "/tmp/repo" }], taskWorktrees: [] });
  upsertTaskWorktree("wt-id-1", "repo-1", "/tmp/wt");

  const taskWorktrees = loadMetadata().taskWorktrees;
  assert.equal(taskWorktrees.length, 1);
  assert.equal(taskWorktrees[0].taskWorktreeId, "wt-id-1");
  assert.equal(taskWorktrees[0].repoId, "repo-1");
  assert.equal(taskWorktrees[0].worktreePath, "/tmp/wt");
});

test("upsertTaskWorktree は同一 ID を二重登録しない", () => {
  seed({ repos: [], taskWorktrees: [] });
  upsertTaskWorktree("wt-id-1", "repo-1", "/tmp/wt");
  upsertTaskWorktree("wt-id-1", "repo-2", "/tmp/wt-new");

  const taskWorktrees = loadMetadata().taskWorktrees;
  assert.equal(taskWorktrees.length, 1);
  assert.equal(taskWorktrees[0].repoId, "repo-2");
  assert.equal(taskWorktrees[0].worktreePath, "/tmp/wt-new");
});

test("attachPrimarySession は taskWorktreeId で primary を付ける", () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo" }],
    taskWorktrees: [{ taskWorktreeId: "wt-1", repoId: "repo-1", worktreePath: "/tmp/wt" }],
  });

  attachPrimarySession("wt-1", { provider: "claude", providerSessionId: "abc" });

  assert.deepEqual(loadMetadata().taskWorktrees[0].primarySession, {
    provider: "claude",
    providerSessionId: "abc",
  });
});

test("attachPrimarySession は同じ provider session を別の worktree から外す", () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo" }],
    taskWorktrees: [
      {
        taskWorktreeId: "wt-1",
        repoId: "repo-1",
        worktreePath: "/tmp/wt-a",
        primarySession: { provider: "claude", providerSessionId: "abc" },
      },
      { taskWorktreeId: "wt-2", repoId: "repo-1", worktreePath: "/tmp/wt-b" },
    ],
  });

  attachPrimarySession("wt-2", { provider: "claude", providerSessionId: "abc" });

  const taskWorktrees = loadMetadata().taskWorktrees;
  const a = taskWorktrees.find((entry) => entry.taskWorktreeId === "wt-1");
  const b = taskWorktrees.find((entry) => entry.taskWorktreeId === "wt-2");
  assert.equal(a.primarySession, undefined);
  assert.deepEqual(b.primarySession, { provider: "claude", providerSessionId: "abc" });
});

test("attachPrimarySession は対象 ID が無ければ何もしない", () => {
  seed({ repos: [], taskWorktrees: [] });
  attachPrimarySession("missing-id", { provider: "claude", providerSessionId: "abc" });
  assert.deepEqual(loadMetadata().taskWorktrees, []);
});

test("removeTaskWorktreeByPath は対象だけ削除する", () => {
  seed({
    repos: [{ id: "repo-1", repoPath: "/tmp/repo" }],
    taskWorktrees: [
      { taskWorktreeId: "wt-1", repoId: "repo-1", worktreePath: "/tmp/wt-a" },
      { taskWorktreeId: "wt-2", repoId: "repo-1", worktreePath: "/tmp/wt-b" },
    ],
  });

  removeTaskWorktreeByPath("/tmp/wt-a");

  const taskWorktrees = loadMetadata().taskWorktrees;
  assert.equal(taskWorktrees.length, 1);
  assert.equal(taskWorktrees[0].taskWorktreeId, "wt-2");
});
