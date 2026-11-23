import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const previousHome = process.env.HOME;
const previousSessionsDb = process.env.CHISEL_SESSION_DB;
const previousKimiCodeHome = process.env.KIMI_CODE_HOME;
const previousAntigravityAppDataDir = process.env.ANTIGRAVITY_APP_DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-antigravity-test-"));
process.env.HOME = tempDir;
process.env.CHISEL_SESSION_DB = path.join(tempDir, "devin-sessions.db");
process.env.KIMI_CODE_HOME = path.join(tempDir, ".kimi-code");
const appDataDir = path.join(tempDir, ".gemini", "antigravity-cli");
process.env.ANTIGRAVITY_APP_DATA_DIR = appDataDir;
const dbPath = path.join(appDataDir, "conversation_summaries.db");

const { agent: antigravityAgent } =
  await import("../../../../src/main/agents/antigravity/index.ts");
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
  if (previousKimiCodeHome === undefined) {
    delete process.env.KIMI_CODE_HOME;
  } else {
    process.env.KIMI_CODE_HOME = previousKimiCodeHome;
  }
  if (previousAntigravityAppDataDir === undefined) {
    delete process.env.ANTIGRAVITY_APP_DATA_DIR;
  } else {
    process.env.ANTIGRAVITY_APP_DATA_DIR = previousAntigravityAppDataDir;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function withDb(run) {
  fs.mkdirSync(appDataDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT "",
      preview TEXT NOT NULL DEFAULT "",
      step_count INTEGER NOT NULL DEFAULT 0,
      last_modified_time DATETIME NOT NULL,
      workspace_uris TEXT NOT NULL,
      parent_conversation_id TEXT NOT NULL DEFAULT "",
      nesting_depth INTEGER NOT NULL DEFAULT 0,
      killed NUMERIC NOT NULL DEFAULT 0
    );
  `);
}

function toSqliteUtcTimestamp(ms) {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "+00:00");
}

function writeAntigravitySession({
  id,
  workDirs,
  title = "",
  preview = "",
  lastModifiedAt = Date.now(),
  parentConversationId = "",
  nestingDepth = 0,
  killed = 0,
  transcriptEntries = [],
}) {
  const uris = workDirs.map((dir) => pathToFileURL(dir).href);
  withDb((db) => {
    initDb(db);
    db.prepare(
      `INSERT INTO conversation_summaries
        (conversation_id, title, preview, last_modified_time, workspace_uris, parent_conversation_id, nesting_depth, killed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      title,
      preview,
      toSqliteUtcTimestamp(lastModifiedAt),
      JSON.stringify(uris),
      parentConversationId,
      nestingDepth,
      killed,
    );
  });

  if (transcriptEntries.length > 0) {
    writeTranscript(id, transcriptEntries);
  }
}

function writeTranscript(id, entries) {
  const logsDir = path.join(appDataDir, "brain", id, ".system_generated", "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const content = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  fs.writeFileSync(path.join(logsDir, "transcript.jsonl"), content, "utf-8");
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
// (antigravity store が存在しない状態を検証するため)。
test("antigravity store が無くても空を返し他 provider の一覧を壊さない", async () => {
  assert.deepEqual(await antigravityAgent.loadStoredSessions(), []);
  assert.equal(await antigravityAgent.loadStoredSessionPreview("missing"), null);
  assert.equal(await antigravityAgent.hasStoredSession("missing"), false);
  assert.deepEqual(await antigravityAgent.loadWorktreeSessionHints(["/nowhere"]), []);

  const suggestions = await loadSuggestedWorktreeSessions(["/nowhere"]);
  assert.equal(suggestions.size, 0);
});

test("新規 Antigravity session は ID 未確定のまま起動する", () => {
  assert.equal(antigravityAgent.resolvesSessionIdLazily, true);
  assert.equal(antigravityAgent.command, "agy");
  assert.deepEqual(antigravityAgent.definition, { id: "antigravity", label: "Antigravity" });
});

test("createWorktreeLaunch は worktree context と初期依頼を --prompt-interactive で渡す", async () => {
  const repoPath = path.join(tempDir, "repo-launch");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "task-a");
  fs.mkdirSync(worktreePath, { recursive: true });

  const request = await antigravityAgent.createWorktreeLaunch({
    repoPath,
    worktreePath,
    worktreeName: "task-a",
    branchName: "feature/task-a",
    initialPrompt: "fix the flaky test",
    model: "gemini-4-neon-high",
  });

  assert.equal(request.cwd, repoPath);
  assert.equal(request.worktreePath, worktreePath);
  assert.deepEqual(request.args.slice(0, 3), [
    "--model",
    "gemini-4-neon-high",
    "--prompt-interactive",
  ]);
  const firstMessage = request.args[3];
  assert.match(firstMessage, /Yuru opened this session for the task worktree 'task-a'/);
  assert.match(firstMessage, new RegExp(worktreePath.replace(/[.]/g, "\\.")));
  assert.match(firstMessage, /User request:\n\nfix the flaky test/);
});

test("createWorktreeLaunch は初期依頼が無ければ context だけを渡す", async () => {
  const request = await antigravityAgent.createWorktreeLaunch({
    repoPath: tempDir,
    worktreePath: tempDir,
    worktreeName: "wt",
    branchName: "wt",
  });

  assert.equal(request.args[0], "--prompt-interactive");
  assert.doesNotMatch(request.args[1], /User request:/);
});

test("createResumeLaunch は記録された cwd で --conversation する", async () => {
  const request = await antigravityAgent.createResumeLaunch({
    provider: "antigravity",
    agentSessionId: "179e671e-e740-4340-a70b-b72acd06ac7f",
    cwd: "/some/dir",
    project: "/some/dir",
  });

  assert.equal(request.cwd, "/some/dir");
  assert.deepEqual(request.args, ["--conversation", "179e671e-e740-4340-a70b-b72acd06ac7f"]);
});

test("loadStoredSessions はトップレベルの会話一覧と最新 PLANNER_RESPONSE を返す", async () => {
  writeAntigravitySession({
    id: "conv-main",
    workDirs: ["/work/a"],
    title: "first session",
    lastModifiedAt: 1_795_000_600_000,
    transcriptEntries: [
      {
        step_index: 0,
        type: "USER_INPUT",
        created_at: "2026-11-23T15:00:00Z",
        content: "<USER_REQUEST>\nhello\n</USER_REQUEST>",
      },
      {
        step_index: 1,
        type: "PLANNER_RESPONSE",
        created_at: "2026-11-23T15:00:01Z",
        tool_calls: [{ name: "read_file" }],
      },
      {
        step_index: 2,
        type: "PLANNER_RESPONSE",
        created_at: "2026-11-23T15:00:05Z",
        content: "latest reply",
      },
    ],
  });
  writeAntigravitySession({
    id: "conv-subagent",
    workDirs: ["/work/a"],
    title: "subagent session",
    lastModifiedAt: 1_795_000_700_000,
    parentConversationId: "conv-main",
    nestingDepth: 1,
  });
  writeAntigravitySession({
    id: "conv-killed",
    workDirs: ["/work/b"],
    title: "killed session",
    lastModifiedAt: 1_795_000_700_000,
    killed: 1,
  });

  const sessions = await antigravityAgent.loadStoredSessions();
  assert.deepEqual(sessions, [
    {
      provider: "antigravity",
      agentSessionId: "conv-main",
      project: "/work/a",
      lastMessage: "latest reply",
      timestamp: Math.max(1_795_000_600_000, Date.parse("2026-11-23T15:00:05Z")),
    },
  ]);
});

test("loadStoredSessionPreview は transcript に返答が無ければ title にフォールバックする", async () => {
  writeAntigravitySession({
    id: "conv-title-only",
    workDirs: ["/work/c"],
    title: "title only",
    lastModifiedAt: 1_795_000_700_000,
    transcriptEntries: [
      {
        step_index: 0,
        type: "USER_INPUT",
        created_at: "2026-11-23T15:00:00Z",
        content: "only a prompt",
      },
    ],
  });

  assert.deepEqual(await antigravityAgent.loadStoredSessionPreview("conv-title-only"), {
    lastMessage: "title only",
    timestamp: 1_795_000_700_000,
  });
  assert.equal(await antigravityAgent.loadStoredSessionPreview("unknown"), null);
});

test("hasStoredSession は可視トップレベル会話だけ true を返す", async () => {
  assert.equal(await antigravityAgent.hasStoredSession("conv-main"), true);
  assert.equal(await antigravityAgent.hasStoredSession("conv-subagent"), false);
  assert.equal(await antigravityAgent.hasStoredSession("conv-killed"), false);
  assert.equal(await antigravityAgent.hasStoredSession("unknown"), false);
});

test("workspace_uris が worktree 内の session をその worktree の suggested として返す", async () => {
  const repoPath = path.join(tempDir, "repo-hint");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "task-a");
  fs.mkdirSync(worktreePath, { recursive: true });
  writeAntigravitySession({
    id: "conv-workdir",
    workDirs: [worktreePath],
    title: "workdir session",
    lastModifiedAt: 1_795_000_800_000,
  });

  const suggestions = await loadSuggestedWorktreeSessions([repoPath, worktreePath]);

  assert.deepEqual(suggestions.get(worktreePath), [
    {
      provider: "antigravity",
      agentSessionId: "conv-workdir",
      cwd: worktreePath,
      timestamp: 1_795_000_800_000,
    },
  ]);
  assert.equal(suggestions.get(repoPath), undefined);
});

test("Yuru 起動セッション (workspace = repo root) は transcript の注入文から worktree を検出する", async () => {
  const repoPath = path.join(tempDir, "repo-mention");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "task-b");
  fs.mkdirSync(worktreePath, { recursive: true });
  writeAntigravitySession({
    id: "conv-injected",
    workDirs: [repoPath],
    title: "injected session",
    lastModifiedAt: 1_795_000_900_000,
    transcriptEntries: [
      {
        step_index: 0,
        type: "USER_INPUT",
        created_at: "2026-11-23T15:00:00Z",
        content:
          "<USER_REQUEST>\n" +
          "Yuru opened this session for the task worktree 'task-b' on branch 'feature/task-b'. " +
          `Use ${worktreePath} as the working directory for this task.\n` +
          "</USER_REQUEST>",
      },
    ],
  });

  const suggestions = await loadSuggestedWorktreeSessions([repoPath, worktreePath]);
  const expected = [
    {
      provider: "antigravity",
      agentSessionId: "conv-injected",
      cwd: repoPath,
      timestamp: 1_795_000_900_000,
    },
  ];

  assert.deepEqual(suggestions.get(worktreePath), expected);
  assert.deepEqual(suggestions.get(repoPath), expected);
});

test("subagent や killed な会話は注入文の言及があっても suggested に出ない", async () => {
  const repoPath = path.join(tempDir, "repo-hidden");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "task-c");
  fs.mkdirSync(worktreePath, { recursive: true });
  writeAntigravitySession({
    id: "conv-hidden-subagent",
    workDirs: [repoPath],
    title: "subagent",
    lastModifiedAt: 1_795_000_900_000,
    parentConversationId: "conv-main",
    nestingDepth: 1,
    transcriptEntries: [
      {
        step_index: 0,
        type: "USER_INPUT",
        content: `Yuru opened this session for the task worktree 'task-c'. Use ${worktreePath} as the working directory.`,
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
    existingAgentSessionIds: new Set(["conv-main"]),
  });
  setTimeout(100).then(() => {
    writeAntigravitySession({
      id: "conv-fresh",
      workDirs: [workDir],
      lastModifiedAt: Date.now(),
      transcriptEntries: [
        {
          step_index: 0,
          type: "USER_INPUT",
          content: `Yuru opened this session ... Use ${worktreePath} as the working directory.`,
        },
      ],
    });
  });

  assert.equal(await antigravityAgent.waitForSessionId(pending), "conv-fresh");
});

test("waitForSessionId は同じ cwd の他の新規 session ではなく自分の session を返す", async () => {
  const workDir = path.join(tempDir, "launch-b");
  const worktreePath = path.join(tempDir, "wt-b");
  const otherWorktreePath = path.join(tempDir, "wt-other");
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  writeAntigravitySession({
    id: "conv-other-launch",
    workDirs: [workDir],
    lastModifiedAt: Date.now(),
    transcriptEntries: [
      {
        step_index: 0,
        type: "USER_INPUT",
        content: `Yuru opened this session ... Use ${otherWorktreePath} as the working directory.`,
      },
    ],
  });

  const pending = fakePending({ launchCwd: workDir, worktreePath });
  setTimeout(100).then(() => {
    writeAntigravitySession({
      id: "conv-mine",
      workDirs: [workDir],
      lastModifiedAt: Date.now(),
    });
    writeTranscript("conv-mine", [
      {
        step_index: 0,
        type: "USER_INPUT",
        content: `Yuru opened this session ... Use ${worktreePath} as the working directory.`,
      },
    ]);
  });

  assert.equal(await antigravityAgent.waitForSessionId(pending), "conv-mine");
});

test("waitForSessionId は process が終了すると失敗する", async () => {
  const pending = fakePending({ launchCwd: path.join(tempDir, "launch-c"), worktreePath: "/wt/c" });
  setTimeout(200).then(() => {
    pending.exited = true;
  });

  await assert.rejects(antigravityAgent.waitForSessionId(pending), {
    message: "Antigravity exited before creating a session",
  });
});
