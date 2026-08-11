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

const { sessionProvider: kimiProvider } = await import("../../../../src/main/agents/kimi/index.ts");
const { loadSuggestedWorktreeSessions } = await import("../../../../src/main/sessions/suggested.ts");

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
  assert.deepEqual(await kimiProvider.loadStoredSessions(), []);
  assert.equal(await kimiProvider.loadStoredSessionPreview("missing"), null);
  assert.equal(await kimiProvider.hasStoredSession("missing"), false);
  assert.deepEqual(await kimiProvider.loadWorktreeSessionHints(["/nowhere"]), []);

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
      providerSessionId: "session_workdir",
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
      providerSessionId: "session_injected",
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
  assert.equal(await kimiProvider.hasStoredSession("session_workdir"), true);
  assert.equal(await kimiProvider.hasStoredSession("unknown"), false);
});

test("hasRecordedInitialInput は wire.jsonl に注入文が記録されたかを返す", async () => {
  const recordedPrompt = `Use ${path.join(tempDir, "repo2", ".yuru", "worktrees", "task-b")} as the working directory for this task.`;
  assert.equal(await kimiProvider.hasRecordedInitialInput("session_injected", recordedPrompt), true);
  assert.equal(await kimiProvider.hasRecordedInitialInput("session_injected", "not in the log"), false);
  assert.equal(await kimiProvider.hasRecordedInitialInput("unknown", recordedPrompt), false);
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

  assert.equal(await kimiProvider.hasRecordedInitialInput("session_escaped", 'say "hi"\nnow'), true);
  assert.equal(await kimiProvider.hasRecordedInitialInput("session_escaped", 'say "hi"\nnow\n'), true);
});
