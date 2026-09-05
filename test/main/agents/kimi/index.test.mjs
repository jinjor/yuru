import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout } from "node:timers/promises";

const previousHome = process.env.HOME;
const previousKimiCodeHome = process.env.KIMI_CODE_HOME;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-kimi-test-"));
process.env.HOME = tempDir;
const kimiDir = path.join(tempDir, ".kimi-code");
process.env.KIMI_CODE_HOME = kimiDir;

const { agent: kimiAgent } = await import("../../../../src/main/agents/kimi/index.ts");
const { loadSuggestedWorktreeSessions } =
  await import("../../../../src/main/sessions/suggested.ts");

test.after(() => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousKimiCodeHome === undefined) {
    delete process.env.KIMI_CODE_HOME;
  } else {
    process.env.KIMI_CODE_HOME = previousKimiCodeHome;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeKimiSession({ sessionId, workDir, state, wireMessages }) {
  const sessionDir = path.join(kimiDir, "sessions", "wd_fixture_000000000000", sessionId);
  fs.mkdirSync(path.join(sessionDir, "agents", "main"), { recursive: true });
  fs.appendFileSync(
    path.join(kimiDir, "session_index.jsonl"),
    `${JSON.stringify({ sessionId, sessionDir, workDir })}\n`,
  );
  if (state) {
    fs.writeFileSync(path.join(sessionDir, "state.json"), JSON.stringify(state));
  }
  if (wireMessages) {
    fs.writeFileSync(kimiWireLogPath(sessionId), toWireLines(wireMessages));
  }
}

function kimiWireLogPath(sessionId) {
  return path.join(kimiDir, "sessions", "wd_fixture_000000000000", sessionId, "agents", "main", "wire.jsonl");
}

function toWireLines(wireMessages) {
  return `${wireMessages.map((message) => JSON.stringify(message)).join("\n")}\n`;
}

function appendKimiUserMessage(sessionId, content) {
  fs.appendFileSync(
    kimiWireLogPath(sessionId),
    toWireLines([
      { type: "context.append_message", message: { role: "user", content, origin: { kind: "user" } } },
    ]),
  );
}

// このテストは fixture を書く他のテストより先に実行される必要がある
// (kimi store が存在しない状態を検証するため)。
test("kimi store が無くても空を返し他 provider の一覧を壊さない", async () => {
  assert.deepEqual(await kimiAgent.loadStoredSessions(), []);
  assert.equal(await kimiAgent.loadStoredSessionPreview("missing"), null);
  assert.equal(await kimiAgent.hasStoredSession("missing"), false);
  assert.deepEqual(await kimiAgent.loadWorktreeSessionHints(["/nowhere"]), []);

  const suggestions = await loadSuggestedWorktreeSessions(["/nowhere"]);
  assert.equal(suggestions.size, 0);
});

test("新規 Kimi session は ID 未確定のまま起動する", () => {
  assert.equal(kimiAgent.resolvesSessionIdLazily, true);
});

// trust / login の画面は答えるまで出たままになるので、入力準備待ちに期限はない。
test("Kimi 初期化は入力可能になるまで何も書き込まず、待ち続ける", async () => {
  const workDir = path.join(tempDir, "trust-prompt");
  fs.mkdirSync(workDir);
  const writes = [];
  const pending = {
    agentSessionId: null,
    launchCwd: workDir,
    existingAgentSessionIds: new Set(),
    initialInput: "startup context",
    initialPrompt: null,
    exited: false,
    proc: {
      write(data) {
        writes.push(data);
      },
    },
    screen: {
      async serialize() {
        return "Trust this folder?";
      },
    },
  };

  const settled = await Promise.race([
    kimiAgent.waitForSessionId(pending).then(
      () => "resolved",
      () => "rejected",
    ),
    setTimeout(2_000, "still waiting"),
  ]);

  assert.equal(settled, "still waiting");
  assert.deepEqual(writes, []);
  // 待ちを終わらせるのは process の終了だけ。
  pending.exited = true;
});

test("Kimi 初期化は入力準備後に context を一度送り、その記録を確認して ID を返す", async () => {
  const workDir = path.join(tempDir, "startup");
  fs.mkdirSync(workDir);
  const initialInput = "Yuru startup context\nUse the task worktree.";
  const screens = ["Trust this folder?", "No session yet"];
  let reads = 0;
  const writes = [];

  const sessionId = await kimiAgent.waitForSessionId({
    agentSessionId: null,
    launchCwd: workDir,
    existingAgentSessionIds: new Set(),
    initialInput,
    initialPrompt: "Requested task sent by the runtime after initialization",
    exited: false,
    proc: {
      write(data) {
        assert.equal(reads, 2, "trust prompt 中には書き込まない");
        writes.push(data);
        if (data === "\r") {
          writeKimiSession({ sessionId: "session_startup", workDir, wireMessages: [] });
          // index は user message が保存されるより先に現れることがある。
          setTimeout(100).then(() => appendKimiUserMessage("session_startup", initialInput));
        }
      },
    },
    screen: {
      async serialize() {
        return screens[Math.min(reads++, screens.length - 1)];
      },
    },
  });

  assert.equal(sessionId, "session_startup");
  assert.equal(await kimiAgent.hasRecordedInitialInput(sessionId, initialInput), true);
  assert.deepEqual(writes, [`\u001b[200~${initialInput}\u001b[201~`, "\r"]);
});

// 同じ repo の別 worktree はどちらも repo root で Kimi を起動するため、workDir だけでは
// 自分の session を選べない。送った context が記録されているかで見分ける。
test("Kimi 初期化は同じ workDir に他の新規 session があっても自分の session を返す", async () => {
  const workDir = path.join(tempDir, "concurrent");
  fs.mkdirSync(workDir);
  const initialInput = "Yuru startup context for the second worktree";
  writeKimiSession({
    sessionId: "session_other_launch",
    workDir,
    wireMessages: [
      {
        type: "context.append_message",
        message: {
          role: "user",
          content: "Yuru startup context for the first worktree",
          origin: { kind: "user" },
        },
      },
    ],
  });

  const sessionId = await kimiAgent.waitForSessionId({
    agentSessionId: null,
    launchCwd: workDir,
    // 起動時点の snapshot なので、同時に走る別の起動が作った session は含まれない。
    existingAgentSessionIds: new Set(),
    initialInput,
    initialPrompt: null,
    exited: false,
    proc: {
      write(data) {
        if (data === "\r") {
          writeKimiSession({ sessionId: "session_mine", workDir, wireMessages: [] });
          appendKimiUserMessage("session_mine", initialInput);
        }
      },
    },
    screen: {
      async serialize() {
        return "No session yet";
      },
    },
  });

  assert.equal(sessionId, "session_mine");
});

test("context が記録されなければ Kimi 初期化は失敗する", { timeout: 20_000 }, async () => {
  const workDir = path.join(tempDir, "context-record");
  fs.mkdirSync(workDir);
  const writes = [];

  await assert.rejects(
    kimiAgent.waitForSessionId({
      agentSessionId: null,
      launchCwd: workDir,
      existingAgentSessionIds: new Set(),
      initialInput: "startup context that never gets recorded",
      initialPrompt: null,
      exited: false,
      screen: {
        async serialize() {
          return "No session yet";
        },
      },
      proc: {
        write(data) {
          writes.push(data);
          if (data === "\r") {
            writeKimiSession({ sessionId: "session_no_context", workDir, wireMessages: [] });
          }
        },
      },
    }),
    { message: "Kimi did not record the worktree context sent as its first message" },
  );
  assert.equal(writes.length, 2);
});

test("workDir が一致する session をその worktree の suggested として返す", async () => {
  const repoPath = path.join(tempDir, "repo");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "task-a");
  fs.mkdirSync(worktreePath, { recursive: true });
  writeKimiSession({
    sessionId: "session_workdir",
    workDir: worktreePath,
    state: {
      title: "workdir session",
      lastPrompt: "last prompt",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:01.000Z",
      workDir: worktreePath,
    },
  });

  const suggestions = await loadSuggestedWorktreeSessions([repoPath, worktreePath]);

  assert.deepEqual(suggestions.get(worktreePath), [
    {
      provider: "kimi",
      agentSessionId: "session_workdir",
      cwd: worktreePath,
      timestamp: Date.parse("2026-05-24T00:00:01.000Z"),
    },
  ]);
  assert.equal(suggestions.get(repoPath), undefined);
});

test("Yuru 起動セッション (workDir = repo root) は wire.jsonl の言及から worktree を検出する", async () => {
  const repoPath = path.join(tempDir, "repo2");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "task-b");
  fs.mkdirSync(worktreePath, { recursive: true });
  writeKimiSession({
    sessionId: "session_injected",
    workDir: repoPath,
    state: {
      title: "injected session",
      lastPrompt: "last prompt",
      createdAt: "2026-05-24T00:00:02.000Z",
      updatedAt: "2026-05-24T00:00:03.000Z",
      workDir: repoPath,
    },
    wireMessages: [
      { type: "metadata", protocol_version: "1.4" },
      {
        type: "context.append_message",
        message: {
          role: "user",
          content:
            "Yuru opened this session for the task worktree 'task-b' on branch 'feature/task-b'. " +
            `Use ${worktreePath} as the working directory for this task.`,
        },
      },
    ],
  });

  const suggestions = await loadSuggestedWorktreeSessions([repoPath, worktreePath]);
  const expected = [
    {
      provider: "kimi",
      agentSessionId: "session_injected",
      cwd: repoPath,
      timestamp: Date.parse("2026-05-24T00:00:03.000Z"),
    },
  ];

  // 注入プロンプトの言及から task worktree に紐づく
  assert.deepEqual(suggestions.get(worktreePath), expected);
  // workDir = repo root なので main worktree にも紐づく (worktree 削除後の救済経路)
  assert.deepEqual(suggestions.get(repoPath), expected);
});

test("hasStoredSession は index の entry と sessionDir の存在を見る", async () => {
  assert.equal(await kimiAgent.hasStoredSession("session_workdir"), true);
  assert.equal(await kimiAgent.hasStoredSession("unknown"), false);
});

test("hasRecordedInitialInput は wire.jsonl に注入文が記録されたかを返す", async () => {
  const recordedPrompt = `Use ${path.join(tempDir, "repo2", ".yuru", "worktrees", "task-b")} as the working directory for this task.`;
  assert.equal(await kimiAgent.hasRecordedInitialInput("session_injected", recordedPrompt), true);
  assert.equal(
    await kimiAgent.hasRecordedInitialInput("session_injected", "not in the log"),
    false,
  );
  assert.equal(await kimiAgent.hasRecordedInitialInput("unknown", recordedPrompt), false);
});

test("hasRecordedInitialInput は JSON escape された注入文にも一致する", async () => {
  writeKimiSession({
    sessionId: "session_escaped",
    workDir: tempDir,
    wireMessages: [
      {
        type: "context.append_message",
        message: { role: "user", content: 'say "hi"\nnow' },
      },
    ],
  });

  assert.equal(await kimiAgent.hasRecordedInitialInput("session_escaped", 'say "hi"\nnow'), true);
  assert.equal(await kimiAgent.hasRecordedInitialInput("session_escaped", 'say "hi"\nnow\n'), true);
});

test("user-origin と assistant text だけを会話本文として返す", async () => {
  writeKimiSession({
    sessionId: "session_messages",
    workDir: tempDir,
    wireMessages: [
      {
        type: "context.append_message",
        message: {
          role: "user",
          content: [{ type: "text", text: "user https://example.com/kimi-user" }],
          origin: { kind: "user" },
        },
      },
      {
        type: "context.append_message",
        message: {
          role: "user",
          content: [{ type: "text", text: "injection https://example.com/kimi-injection" }],
          origin: { kind: "injection" },
        },
      },
      {
        type: "context.append_message",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Yuru opened this session for the task worktree 'task'. " +
                "https://example.com/kimi-context",
            },
          ],
          origin: { kind: "user" },
        },
      },
      {
        type: "context.append_loop_event",
        event: {
          type: "content.part",
          part: { type: "text", text: "assistant https://example.com/kimi-answer" },
        },
      },
      {
        type: "context.append_loop_event",
        event: {
          type: "tool.result",
          result: "tool output https://example.com/kimi-tool",
        },
      },
      {
        type: "context.append_loop_event",
        event: { type: "content.part", part: { type: "think", think: "thinking URL" } },
      },
    ],
  });

  const messages = [];
  const stopMessages = await kimiAgent.watchSessionMessages(
    "session_messages",
    true,
    (next) => messages.push(...next),
  );
  await kimiAgent.loadStoredSessionPreview("session_messages");
  assert.deepEqual(messages, [
    "user https://example.com/kimi-user",
    "assistant https://example.com/kimi-answer",
  ]);
  await kimiAgent.loadStoredSessionPreview("session_messages");
  assert.equal(messages.length, 2);
  stopMessages();
});
