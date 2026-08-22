import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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
    fs.writeFileSync(
      path.join(sessionDir, "agents", "main", "wire.jsonl"),
      `${wireMessages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    );
  }
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
