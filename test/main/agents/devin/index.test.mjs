import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";

const previousHome = process.env.HOME;
const previousSessionsDb = process.env.CHISEL_SESSION_DB;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-devin-test-"));
process.env.HOME = tempDir;
const dbPath = path.join(tempDir, "sessions.db");
process.env.CHISEL_SESSION_DB = dbPath;

const { agent: devinAgent } = await import("../../../../src/main/agents/devin/index.ts");
const { loadSuggestedWorktreeSessions } =
  await import("../../../../src/main/sessions/suggested.ts");

test.after(() => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousSessionsDb === undefined) {
    delete process.env.CHISEL_SESSION_DB;
  } else {
    process.env.CHISEL_SESSION_DB = previousSessionsDb;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function withDb(run) {
  const db = new DatabaseSync(dbPath);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      working_directory TEXT NOT NULL,
      backend_type TEXT,
      model TEXT,
      agent_mode TEXT,
      created_at INTEGER NOT NULL,
      last_activity_at INTEGER NOT NULL,
      title TEXT,
      hidden INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS message_nodes (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      node_id INTEGER NOT NULL,
      parent_node_id INTEGER,
      chat_message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

function writeDevinSession({ id, workDir, title, createdAt, lastActivityAt, hidden, messages }) {
  withDb((db) => {
    initDb(db);
    db.prepare(
      `INSERT INTO sessions (id, working_directory, created_at, last_activity_at, title, hidden)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      workDir,
      Math.floor(createdAt / 1000),
      Math.floor((lastActivityAt ?? createdAt) / 1000),
      title ?? null,
      hidden ?? 0,
    );
    let nodeId = 0;
    for (const message of messages ?? []) {
      nodeId += 1;
      db.prepare(
        `INSERT INTO message_nodes (session_id, node_id, chat_message, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(
        id,
        nodeId,
        JSON.stringify({ message_id: `${id}-${nodeId}`, ...message }),
        Math.floor((message.createdAt ?? createdAt) / 1000),
      );
    }
  });
}

function appendDevinUserMessage(id, content) {
  withDb((db) => {
    initDb(db);
    const nextNodeId =
      (db
        .prepare(`SELECT MAX(node_id) AS max_id FROM message_nodes WHERE session_id = ?`)
        .get(id)?.max_id ?? -1) + 1;
    db.prepare(
      `INSERT INTO message_nodes (session_id, node_id, chat_message, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(id, nextNodeId, JSON.stringify({ role: "user", content }), Math.floor(Date.now() / 1000));
  });
}

function fakePending(overrides) {
  return {
    agentSessionId: null,
    launchCwd: tempDir,
    existingAgentSessionIds: new Set(),
    initialInput: null,
    initialPrompt: null,
    exited: false,
    proc: { write() {} },
    startedAt: Date.now(),
    worktreePath: tempDir,
    ...overrides,
  };
}

// このテストは fixture を書く他のテストより先に実行される必要がある
// (devin store が存在しない状態を検証するため)。
test("devin store が無くても空を返し他 provider の一覧を壊さない", async () => {
  assert.deepEqual(await devinAgent.loadStoredSessions(), []);
  assert.equal(await devinAgent.loadStoredSessionPreview("missing"), null);
  assert.equal(await devinAgent.hasStoredSession("missing"), false);
  assert.deepEqual(await devinAgent.loadWorktreeSessionHints(["/nowhere"]), []);

  const suggestions = await loadSuggestedWorktreeSessions(["/nowhere"]);
  assert.equal(suggestions.size, 0);
});

test("新規 Devin session は ID 未確定のまま起動する", () => {
  assert.equal(devinAgent.resolvesSessionIdLazily, true);
});

test("createWorktreeLaunch は worktree context と初期依頼を最初の user message として渡す", async () => {
  const repoPath = path.join(tempDir, "repo-launch");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "task-a");
  fs.mkdirSync(worktreePath, { recursive: true });

  const request = await devinAgent.createWorktreeLaunch({
    repoPath,
    worktreePath,
    worktreeName: "task-a",
    branchName: "feature/task-a",
    initialPrompt: "fix the flaky test",
    model: "swe-2-high",
  });

  assert.equal(request.cwd, repoPath);
  assert.equal(request.worktreePath, worktreePath);
  assert.deepEqual(request.args.slice(0, 2), ["--model", "swe-2-high"]);
  assert.equal(request.args[2], "--");
  const firstMessage = request.args[3];
  assert.match(firstMessage, /Yuru opened this session for the task worktree 'task-a'/);
  assert.match(firstMessage, new RegExp(worktreePath.replace(/[.]/g, "\\.")));
  assert.match(firstMessage, /User request:\n\nfix the flaky test/);
});

test("createWorktreeLaunch は初期依頼が無ければ context だけを渡す", async () => {
  const request = await devinAgent.createWorktreeLaunch({
    repoPath: tempDir,
    worktreePath: tempDir,
    worktreeName: "wt",
    branchName: "wt",
  });

  assert.equal(request.args.at(-2), "--");
  assert.doesNotMatch(request.args.at(-1), /User request:/);
});

test("createResumeLaunch は記録された cwd で --resume する", async () => {
  const request = await devinAgent.createResumeLaunch({
    provider: "devin",
    agentSessionId: "calm-otter",
    cwd: "/some/dir",
    project: "/some/dir",
  });

  assert.equal(request.cwd, "/some/dir");
  assert.deepEqual(request.args, ["--resume", "calm-otter"]);
});

test("loadStoredSessions は session 一覧と最新 assistant message を返す", async () => {
  writeDevinSession({
    id: "quiet-river",
    workDir: "/work/a",
    title: "first session",
    createdAt: 1_790_000_000_000,
    lastActivityAt: 1_790_000_600_000,
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "latest reply" },
    ],
  });
  writeDevinSession({
    id: "hidden-fox",
    workDir: "/work/b",
    title: "hidden session",
    createdAt: 1_790_000_000_000,
    hidden: 1,
  });

  const sessions = await devinAgent.loadStoredSessions();
  assert.deepEqual(sessions, [
    {
      provider: "devin",
      agentSessionId: "quiet-river",
      project: "/work/a",
      lastMessage: "latest reply",
      timestamp: 1_790_000_600_000,
    },
  ]);
});

test("loadStoredSessionPreview は assistant message が無ければ title にフォールバックする", async () => {
  writeDevinSession({
    id: "empty-bird",
    workDir: "/work/c",
    title: "title only",
    createdAt: 1_790_000_000_000,
    lastActivityAt: 1_790_000_700_000,
    messages: [{ role: "user", content: "only a prompt" }],
  });

  assert.deepEqual(await devinAgent.loadStoredSessionPreview("empty-bird"), {
    lastMessage: "title only",
    timestamp: 1_790_000_700_000,
  });
  assert.equal(await devinAgent.loadStoredSessionPreview("unknown"), null);
});

test("hasStoredSession は session 行の存在を見る", async () => {
  assert.equal(await devinAgent.hasStoredSession("quiet-river"), true);
  assert.equal(await devinAgent.hasStoredSession("unknown"), false);
});

test("working_directory が worktree 内の session をその worktree の suggested として返す", async () => {
  const repoPath = path.join(tempDir, "repo-hint");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "task-a");
  fs.mkdirSync(worktreePath, { recursive: true });
  writeDevinSession({
    id: "workdir-deer",
    workDir: worktreePath,
    title: "workdir session",
    createdAt: 1_790_000_000_000,
    lastActivityAt: 1_790_000_800_000,
  });

  const suggestions = await loadSuggestedWorktreeSessions([repoPath, worktreePath]);

  assert.deepEqual(suggestions.get(worktreePath), [
    {
      provider: "devin",
      agentSessionId: "workdir-deer",
      cwd: worktreePath,
      timestamp: 1_790_000_800_000,
    },
  ]);
  assert.equal(suggestions.get(repoPath), undefined);
});

test("Yuru 起動セッション (working_directory = repo root) は注入文の言及から worktree を検出する", async () => {
  const repoPath = path.join(tempDir, "repo-mention");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "task-b");
  fs.mkdirSync(worktreePath, { recursive: true });
  writeDevinSession({
    id: "injected-seal",
    workDir: repoPath,
    title: "injected session",
    createdAt: 1_790_000_000_000,
    lastActivityAt: 1_790_000_900_000,
    messages: [
      { role: "system", content: "system prompt" },
      {
        role: "user",
        content:
          "Yuru opened this session for the task worktree 'task-b' on branch 'feature/task-b'. " +
          `Use ${worktreePath} as the working directory for this task.`,
      },
    ],
  });

  const suggestions = await loadSuggestedWorktreeSessions([repoPath, worktreePath]);
  const expected = [
    {
      provider: "devin",
      agentSessionId: "injected-seal",
      cwd: repoPath,
      timestamp: 1_790_000_900_000,
    },
  ];

  // 注入プロンプトの言及から task worktree に紐づく
  assert.deepEqual(suggestions.get(worktreePath), expected);
  // working_directory = repo root なので main worktree にも紐づく (worktree 削除後の救済経路)
  assert.deepEqual(suggestions.get(repoPath), expected);
});

test("hidden session は注入文の言及があっても suggested に出ない", async () => {
  const repoPath = path.join(tempDir, "repo-hidden");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "task-c");
  fs.mkdirSync(worktreePath, { recursive: true });
  writeDevinSession({
    id: "hidden-mole",
    workDir: repoPath,
    title: "hidden injected session",
    createdAt: 1_790_000_000_000,
    hidden: 1,
    messages: [
      {
        role: "user",
        content: `Yuru opened this session ... Use ${worktreePath} as the working directory.`,
      },
    ],
  });

  const suggestions = await loadSuggestedWorktreeSessions([repoPath, worktreePath]);

  assert.equal(suggestions.get(worktreePath), undefined);
  assert.equal(suggestions.get(repoPath), undefined);
});

test("waitForSessionId は注入 context を記録した新規 session を返す", async () => {
  const workDir = path.join(tempDir, "launch-a");
  const worktreePath = path.join(tempDir, "wt-a");
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });

  const pending = fakePending({
    launchCwd: workDir,
    worktreePath,
    existingAgentSessionIds: new Set(["quiet-river"]),
  });
  setTimeout(100).then(() => {
    writeDevinSession({
      id: "fresh-newt",
      workDir,
      createdAt: Date.now(),
      messages: [
        {
          role: "user",
          content: `Yuru opened this session ... Use ${worktreePath} as the working directory.`,
        },
      ],
    });
  });

  assert.equal(await devinAgent.waitForSessionId(pending), "fresh-newt");
});

test("waitForSessionId は同じ cwd の他の新規 session ではなく自分の session を返す", async () => {
  const workDir = path.join(tempDir, "launch-b");
  const worktreePath = path.join(tempDir, "wt-b");
  const otherWorktreePath = path.join(tempDir, "wt-other");
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  // 同時に走る別 worktree 向けの起動が先に session を作る。
  writeDevinSession({
    id: "other-launch",
    workDir,
    createdAt: Date.now(),
    messages: [
      {
        role: "user",
        content: `Yuru opened this session ... Use ${otherWorktreePath} as the working directory.`,
      },
    ],
  });

  const pending = fakePending({ launchCwd: workDir, worktreePath });
  setTimeout(100).then(() => {
    writeDevinSession({ id: "mine", workDir, createdAt: Date.now(), messages: [] });
    appendDevinUserMessage(
      "mine",
      `Yuru opened this session ... Use ${worktreePath} as the working directory.`,
    );
  });

  assert.equal(await devinAgent.waitForSessionId(pending), "mine");
});

test("waitForSessionId は process が終了すると失敗する", async () => {
  const pending = fakePending({ launchCwd: path.join(tempDir, "launch-c"), worktreePath: "/wt/c" });
  setTimeout(200).then(() => {
    pending.exited = true;
  });

  await assert.rejects(devinAgent.waitForSessionId(pending), {
    message: "Devin exited before creating a session",
  });
});
