import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const previousHome = process.env.HOME;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-sessions-test-"));
process.env.HOME = tempDir;

const claudeDir = path.join(tempDir, ".claude");
const codexDir = path.join(tempDir, ".codex");
const staleProject = path.join(tempDir, "missing-worktree");
const missingClaudeSessionId = "claude-missing-file";
fs.mkdirSync(claudeDir, { recursive: true });
fs.mkdirSync(codexDir, { recursive: true });
fs.writeFileSync(
  path.join(claudeDir, "history.jsonl"),
  `${JSON.stringify({
    sessionId: "claude-1",
    project: staleProject,
    display: "last message",
    timestamp: 1000,
  })}\n${JSON.stringify({
    sessionId: missingClaudeSessionId,
    project: staleProject,
    display: "missing session file",
    timestamp: 2000,
  })}\n`,
);

const {
  loadStoredSessionActivity,
  loadStoredSessionPreview,
  loadStoredSessionPreviews,
  loadSuggestedWorktreeSessions,
} = await import("../../src/main/sessions.ts");
const { sessionProvider: codexProvider } = await import("../../src/main/agents/codex/index.ts");
const { sessionProvider: claudeProvider } = await import("../../src/main/agents/claude/index.ts");
const { toSessionKey } = await import("../../src/shared/session.ts");

function jsonl(...entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function claudeProjectDirName(project) {
  return project.replace(/[/.]/g, "-");
}

function codexSessionFilePath(codexHome, sessionId) {
  const timestamp = Number.parseInt(sessionId.replace(/-/g, "").slice(0, 12), 16);
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return path.join(
    codexHome,
    "sessions",
    year,
    month,
    day,
    `rollout-${year}-${month}-${day}T${hour}-${minute}-${second}-${sessionId}.jsonl`,
  );
}

const codexSessionId = "019e5862-8776-7723-8de9-3460e9600119";
const claudeProjectDir = path.join(claudeDir, "projects", claudeProjectDirName(staleProject));
fs.mkdirSync(claudeProjectDir, { recursive: true });
fs.writeFileSync(
  path.join(claudeProjectDir, "claude-1.jsonl"),
  jsonl(
    {
      type: "assistant",
      sessionId: "claude-1",
      timestamp: "2026-05-24T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "old claude assistant message" }],
      },
    },
    {
      type: "assistant",
      sessionId: "claude-1",
      timestamp: "2026-05-24T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "new claude assistant message" }],
      },
    },
  ),
);

const codexSessionFile = codexSessionFilePath(codexDir, codexSessionId);
fs.mkdirSync(path.dirname(codexSessionFile), { recursive: true });
fs.writeFileSync(
  codexSessionFile,
  jsonl(
    {
      type: "session_meta",
      timestamp: "2026-05-24T00:00:00.000Z",
      payload: {
        id: codexSessionId,
        cwd: staleProject,
      },
    },
    {
      type: "response_item",
      timestamp: "2026-05-24T00:00:01.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "old codex assistant message" }],
      },
    },
    {
      type: "response_item",
      timestamp: "2026-05-24T00:00:02.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "new codex assistant message" }],
      },
    },
  ),
);

test.after(() => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("loadStoredSessionPreviews は stored session の preview を key で返す", async () => {
  const previews = await loadStoredSessionPreviews();

  assert.equal(previews.get(toSessionKey("claude", "claude-1")), "new claude assistant message");
  assert.equal(previews.get(toSessionKey("codex", codexSessionId)), "new codex assistant message");
  assert.equal(previews.has(toSessionKey("claude", missingClaudeSessionId)), false);
});

test("loadStoredSessionPreview は指定 session の preview だけを返す", async () => {
  fs.writeFileSync(
    path.join(codexDir, "history.jsonl"),
    jsonl(
      { session_id: codexSessionId, text: "history should not be used", ts: 1 },
      { session_id: "codex-2", text: "other codex message", ts: 3 },
    ),
  );

  assert.equal(await loadStoredSessionPreview("claude", "claude-1"), "new claude assistant message");
  assert.equal(await loadStoredSessionPreview("claude", missingClaudeSessionId), null);
  assert.equal(await loadStoredSessionPreview("codex", codexSessionId), "new codex assistant message");
  assert.equal(await loadStoredSessionPreview("codex", "missing"), null);
});

test("loadStoredSessionActivity は Codex の task event から作業状態を返す", async () => {
  const workingSessionId = "019e5862-8776-7723-8de9-3460e9600120";
  const waitingSessionId = "019e5862-8776-7723-8de9-3460e9600121";
  const interruptedSessionId = "019e5862-8776-7723-8de9-3460e9600122";
  const workingSessionFile = codexSessionFilePath(codexDir, workingSessionId);
  const waitingSessionFile = codexSessionFilePath(codexDir, waitingSessionId);
  const interruptedSessionFile = codexSessionFilePath(codexDir, interruptedSessionId);
  fs.mkdirSync(path.dirname(workingSessionFile), { recursive: true });
  fs.writeFileSync(
    workingSessionFile,
    jsonl(
      {
        type: "session_meta",
        payload: { id: workingSessionId, cwd: staleProject },
      },
      {
        type: "event_msg",
        payload: { type: "task_started" },
      },
    ),
  );
  fs.writeFileSync(
    waitingSessionFile,
    jsonl(
      {
        type: "session_meta",
        payload: { id: waitingSessionId, cwd: staleProject },
      },
      {
        type: "event_msg",
        payload: { type: "task_started" },
      },
      {
        type: "event_msg",
        payload: { type: "task_complete" },
      },
    ),
  );
  fs.writeFileSync(
    interruptedSessionFile,
    jsonl(
      {
        type: "session_meta",
        payload: { id: interruptedSessionId, cwd: staleProject },
      },
      {
        type: "event_msg",
        payload: { type: "task_started" },
      },
      {
        type: "event_msg",
        payload: { type: "turn_aborted" },
      },
    ),
  );

  assert.equal(await loadStoredSessionActivity("codex", workingSessionId), "working");
  assert.equal(await loadStoredSessionActivity("codex", waitingSessionId), "waiting");
  assert.equal(await loadStoredSessionActivity("codex", interruptedSessionId), "waiting");
  assert.equal(await loadStoredSessionActivity("codex", codexSessionId), null);
});

test("loadStoredSessionActivity は Claude の turn_duration から作業状態を返す", async () => {
  const workingSessionId = "claude-working";
  const waitingSessionId = "claude-waiting";
  const pendingPromptSessionId = "claude-pending-prompt";
  const slashCommandSessionId = "claude-slash-command";
  const localCommandSessionId = "claude-local-command";
  const interruptedSessionId = "claude-interrupted";
  const interruptedPromptSessionId = "claude-interrupted-prompt";
  fs.appendFileSync(
    path.join(claudeDir, "history.jsonl"),
    jsonl(
      {
        sessionId: workingSessionId,
        project: staleProject,
        display: "working",
        timestamp: 3000,
      },
      {
        sessionId: waitingSessionId,
        project: staleProject,
        display: "waiting",
        timestamp: 4000,
      },
      {
        sessionId: pendingPromptSessionId,
        project: staleProject,
        display: "pending prompt",
        timestamp: 4500,
      },
      {
        sessionId: slashCommandSessionId,
        project: staleProject,
        display: "slash command",
        timestamp: 5000,
      },
      {
        sessionId: localCommandSessionId,
        project: staleProject,
        display: "local command",
        timestamp: 6000,
      },
      {
        sessionId: interruptedSessionId,
        project: staleProject,
        display: "interrupted",
        timestamp: 7000,
      },
      {
        sessionId: interruptedPromptSessionId,
        project: staleProject,
        display: "interrupted prompt",
        timestamp: 8000,
      },
    ),
  );
  fs.writeFileSync(
    path.join(claudeProjectDir, `${workingSessionId}.jsonl`),
    jsonl(
      {
        type: "user",
        sessionId: workingSessionId,
        message: { role: "user", content: "do work" },
      },
      {
        type: "assistant",
        sessionId: workingSessionId,
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Bash", input: {} }],
        },
      },
    ),
  );
  fs.writeFileSync(
    path.join(claudeProjectDir, `${waitingSessionId}.jsonl`),
    jsonl(
      {
        type: "user",
        sessionId: waitingSessionId,
        message: { role: "user", content: "do work" },
      },
      {
        type: "assistant",
        sessionId: waitingSessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      },
      {
        type: "system",
        sessionId: waitingSessionId,
        subtype: "turn_duration",
      },
      {
        type: "last-prompt",
        sessionId: waitingSessionId,
      },
    ),
  );
  fs.writeFileSync(
    path.join(claudeProjectDir, `${pendingPromptSessionId}.jsonl`),
    jsonl(
      {
        type: "user",
        sessionId: pendingPromptSessionId,
        message: { role: "user", content: "previous prompt" },
      },
      {
        type: "assistant",
        sessionId: pendingPromptSessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      },
      {
        type: "system",
        sessionId: pendingPromptSessionId,
        subtype: "turn_duration",
      },
      {
        type: "user",
        sessionId: pendingPromptSessionId,
        promptSource: "typed",
        message: { role: "user", content: "next prompt" },
      },
    ),
  );
  fs.writeFileSync(
    path.join(claudeProjectDir, `${slashCommandSessionId}.jsonl`),
    jsonl(
      {
        type: "user",
        sessionId: slashCommandSessionId,
        message: { role: "user", content: "first prompt" },
      },
      {
        type: "assistant",
        sessionId: slashCommandSessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      },
      {
        type: "system",
        sessionId: slashCommandSessionId,
        subtype: "turn_duration",
      },
      {
        type: "user",
        sessionId: slashCommandSessionId,
        promptSource: "typed",
        message: { role: "user", content: "/model" },
      },
    ),
  );
  fs.writeFileSync(
    path.join(claudeProjectDir, `${localCommandSessionId}.jsonl`),
    jsonl(
      {
        type: "assistant",
        sessionId: localCommandSessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      },
      {
        type: "system",
        sessionId: localCommandSessionId,
        subtype: "turn_duration",
      },
      {
        type: "assistant",
        sessionId: localCommandSessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "No response requested." }],
        },
      },
      {
        type: "user",
        sessionId: localCommandSessionId,
        isMeta: true,
        message: {
          role: "user",
          content:
            "<local-command-caveat>Caveat: local command messages follow.</local-command-caveat>",
        },
      },
      {
        type: "user",
        sessionId: localCommandSessionId,
        message: {
          role: "user",
          content: "<command-name>/model</command-name><command-message>model</command-message>",
        },
      },
      {
        type: "user",
        sessionId: localCommandSessionId,
        message: {
          role: "user",
          content:
            "<local-command-stdout>Set model to Opus 4.8 and saved as your default for new sessions</local-command-stdout>",
        },
      },
      {
        type: "last-prompt",
        sessionId: localCommandSessionId,
      },
    ),
  );
  fs.writeFileSync(
    path.join(claudeProjectDir, `${interruptedSessionId}.jsonl`),
    jsonl(
      {
        type: "user",
        sessionId: interruptedSessionId,
        promptSource: "typed",
        message: { role: "user", content: "do long work" },
      },
      {
        type: "assistant",
        sessionId: interruptedSessionId,
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: {} }],
        },
      },
      {
        type: "user",
        sessionId: interruptedSessionId,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              content: "The user does not want to proceed with this tool use.",
              is_error: true,
              tool_use_id: "toolu_1",
            },
          ],
        },
      },
      {
        type: "user",
        sessionId: interruptedSessionId,
        interruptedMessageId: "msg_1",
        message: {
          role: "user",
          content: [{ type: "text", text: "[Request interrupted by user for tool use]" }],
        },
      },
      {
        type: "system",
        sessionId: interruptedSessionId,
        subtype: "away_summary",
      },
    ),
  );
  fs.writeFileSync(
    path.join(claudeProjectDir, `${interruptedPromptSessionId}.jsonl`),
    jsonl(
      {
        type: "user",
        sessionId: interruptedPromptSessionId,
        promptSource: "typed",
        message: { role: "user", content: "do long work" },
      },
      {
        type: "assistant",
        sessionId: interruptedPromptSessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "partial response" }],
        },
      },
      {
        type: "user",
        sessionId: interruptedPromptSessionId,
        message: {
          role: "user",
          content: [{ type: "text", text: "[Request interrupted by user]" }],
        },
      },
    ),
  );

  assert.equal(await loadStoredSessionActivity("claude", workingSessionId), "working");
  assert.equal(await loadStoredSessionActivity("claude", waitingSessionId), "waiting");
  assert.equal(await loadStoredSessionActivity("claude", pendingPromptSessionId), "waiting");
  assert.equal(await loadStoredSessionActivity("claude", slashCommandSessionId), "waiting");
  assert.equal(await loadStoredSessionActivity("claude", localCommandSessionId), "waiting");
  assert.equal(await loadStoredSessionActivity("claude", interruptedSessionId), "waiting");
  assert.equal(await loadStoredSessionActivity("claude", interruptedPromptSessionId), "waiting");
  assert.equal(await loadStoredSessionActivity("claude", "missing"), null);
  assert.equal(
    await loadStoredSessionActivity("claude", slashCommandSessionId, { outputActive: true }),
    "waiting",
  );
  assert.equal(
    await loadStoredSessionActivity("claude", localCommandSessionId, { outputActive: true }),
    "waiting",
  );
  assert.equal(
    await loadStoredSessionActivity("claude", pendingPromptSessionId, { outputActive: true }),
    "working",
  );
});

test("Claude stored session の存在判定は session file の存在を見る", async () => {
  assert.equal(await claudeProvider.hasStoredSession("claude-1"), true);
  assert.equal(await claudeProvider.hasStoredSession(missingClaudeSessionId), false);
});

test("provider resume launch は session の記録場所 (target.cwd) で起動する", async () => {
  const repoRoot = path.join(tempDir, "repo");
  const worktreePath = path.join(repoRoot, ".yuru", "worktrees", "task-a");

  assert.deepEqual(
    await claudeProvider.createResumeLaunch({
      provider: "claude",
      providerSessionId: "claude-resume",
      cwd: worktreePath,
      project: worktreePath,
    }),
    {
      cwd: worktreePath,
      args: ["--resume", "claude-resume"],
      worktreePath,
    },
  );
  assert.deepEqual(
    await codexProvider.createResumeLaunch({
      provider: "codex",
      providerSessionId: "codex-resume",
      cwd: worktreePath,
      project: worktreePath,
    }),
    {
      cwd: worktreePath,
      args: ["resume", "--all", "codex-resume"],
      worktreePath,
    },
  );
});

test("provider worktree launch は repo root で起動して hidden context を注入する", async () => {
  const repoPath = path.join(tempDir, "launch-repo");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "task-a");
  const context = {
    repoPath,
    worktreePath,
    worktreeName: "task-a",
    branchName: "feature/task-a",
  };
  const prompt =
    "Yuru opened this session for the task worktree 'task-a' on branch 'feature/task-a'. " +
    `Use ${worktreePath} as the working directory for this task. ` +
    `When reading files, editing files, applying patches, running commands, building, or testing, operate in ${worktreePath}. ` +
    `The repository root ${repoPath} is only the parent repository that Yuru used to launch this provider session; do not treat it as the task workspace unless the user explicitly asks you to.`;

  assert.deepEqual(await claudeProvider.createWorktreeLaunch(context), {
    cwd: repoPath,
    args: ["--append-system-prompt", prompt],
    worktreePath,
  });

  const codexLaunch = await codexProvider.createWorktreeLaunch(context);
  assert.equal(codexLaunch.cwd, repoPath);
  assert.deepEqual(codexLaunch.args, [
    "-c",
    `developer_instructions=${JSON.stringify(prompt)}`,
  ]);
  assert.equal(codexLaunch.worktreePath, worktreePath);
  assert.ok(codexLaunch.existingProviderSessionIds instanceof Set);
});

test("loadSuggestedWorktreeSessions は suggested session を worktree ごとに dedup して並べる", async () => {
  const projectsDir = path.join(claudeDir, "projects", "repo");
  fs.mkdirSync(projectsDir, { recursive: true });
  const worktreeA = path.join(tempDir, "repo", ".claude", "worktrees", "task-a");
  const worktreeB = path.join(tempDir, "repo", ".claude", "worktrees", "task-b");
  fs.writeFileSync(
    path.join(projectsDir, "b.jsonl"),
    jsonl({
      type: "user",
      sessionId: "claude-b",
      cwd: path.join(worktreeA, "src"),
    }),
  );
  fs.writeFileSync(
    path.join(projectsDir, "a.jsonl"),
    jsonl({
      type: "user",
      sessionId: "claude-a",
      cwd: worktreeA,
    }),
  );
  fs.writeFileSync(
    path.join(projectsDir, "a-duplicate.jsonl"),
    jsonl({
      type: "assistant",
      sessionId: "claude-a",
      cwd: worktreeA,
    }),
  );
  fs.writeFileSync(
    path.join(projectsDir, "other-worktree.jsonl"),
    jsonl({
      type: "user",
      sessionId: "claude-a",
      cwd: worktreeB,
    }),
  );
  const codexSessionsDir = path.join(codexDir, "sessions", "2026", "05", "08");
  fs.mkdirSync(codexSessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexSessionsDir, "codex-a.jsonl"),
    jsonl({
      type: "session_meta",
      payload: {
        id: "codex-a",
        cwd: path.join(worktreeA, "src"),
      },
    }),
  );
  fs.writeFileSync(
    path.join(codexSessionsDir, "codex-b.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-b",
          cwd: path.join(tempDir, "repo"),
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          cwd: worktreeB,
        },
      },
    ),
  );

  const suggestions = await loadSuggestedWorktreeSessions([worktreeB, worktreeA]);

  assert.deepEqual(suggestions.get(worktreeA), [
    { provider: "claude", providerSessionId: "claude-a", cwd: worktreeA, timestamp: 0 },
    { provider: "claude", providerSessionId: "claude-b", cwd: worktreeA, timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-a", cwd: path.join(worktreeA, "src"), timestamp: 0 },
  ]);
  assert.deepEqual(suggestions.get(worktreeB), [
    { provider: "claude", providerSessionId: "claude-a", cwd: worktreeB, timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-b", cwd: path.join(tempDir, "repo"), timestamp: 0 },
  ]);
});

test("loadSuggestedWorktreeSessions は rg が無ければ失敗する", async () => {
  const previousPath = process.env.PATH;
  const emptyBinDir = path.join(tempDir, "empty-bin");
  const worktreePath = path.join(tempDir, "repo-rg-required", ".yuru", "worktrees", "task-a");
  fs.mkdirSync(emptyBinDir, { recursive: true });
  fs.mkdirSync(path.join(claudeDir, "projects", "rg-required"), { recursive: true });

  process.env.PATH = emptyBinDir;
  try {
    await assert.rejects(() => loadSuggestedWorktreeSessions([worktreePath]), {
      code: "ENOENT",
    });
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }
});

test("loadSuggestedWorktreeSessions は同じ worktreeRank なら session id で安定して並べる", async () => {
  const worktreePath = path.join(tempDir, "repo", ".yuru", "worktrees", "ranked");
  const codexSessionsDir = path.join(codexDir, "sessions", "2026", "05", "09");
  fs.mkdirSync(codexSessionsDir, { recursive: true });

  fs.writeFileSync(
    path.join(codexSessionsDir, "rank-weak.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-weak",
          cwd: path.join(tempDir, "repo"),
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          content: [{ type: "output_text", text: `Created ${worktreePath}` }],
        },
      },
    ),
  );
  fs.writeFileSync(
    path.join(codexSessionsDir, "rank-patch.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-patch",
          cwd: path.join(tempDir, "repo"),
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          changes: {
            [path.join(worktreePath, "file.txt")]: { type: "add" },
          },
        },
      },
    ),
  );
  fs.writeFileSync(
    path.join(codexSessionsDir, "rank-workdir.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-workdir",
          cwd: path.join(tempDir, "repo"),
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pwd", workdir: worktreePath }),
        },
      },
    ),
  );
  fs.writeFileSync(
    path.join(codexSessionsDir, "rank-meta.jsonl"),
    jsonl({
      type: "session_meta",
      payload: {
        id: "codex-meta",
        cwd: worktreePath,
      },
    }),
  );

  const suggestions = await loadSuggestedWorktreeSessions([worktreePath]);

  assert.deepEqual(suggestions.get(worktreePath), [
    { provider: "codex", providerSessionId: "codex-meta", cwd: worktreePath, timestamp: 0 },
    {
      provider: "codex",
      providerSessionId: "codex-patch",
      cwd: path.join(tempDir, "repo"),
      timestamp: 0,
    },
    {
      provider: "codex",
      providerSessionId: "codex-workdir",
      cwd: path.join(tempDir, "repo"),
      timestamp: 0,
    },
  ]);
});

test("loadSuggestedWorktreeSessions は短い worktree 名でも Codex ログの大量一致で落ちない", async (t) => {
  const repoPath = path.join(tempDir, "repo-short-noise");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "f40");
  const codexSessionsDir = path.join(codexDir, "sessions", "2026", "05", "short-noise");
  fs.mkdirSync(codexSessionsDir, { recursive: true });
  t.after(() => {
    fs.rmSync(codexSessionsDir, { recursive: true, force: true });
  });

  const noiseLine = JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      content: [{ type: "output_text", text: "f40 ".repeat(1024) }],
    },
  });
  fs.writeFileSync(
    path.join(codexSessionsDir, "short-name-noise.jsonl"),
    `${JSON.stringify({
      type: "session_meta",
      payload: {
        id: "codex-noise",
        cwd: repoPath,
      },
    })}\n${`${noiseLine}\n`.repeat(3000)}`,
  );

  const suggestions = await loadSuggestedWorktreeSessions([worktreePath]);

  assert.equal(suggestions.get(worktreePath), undefined);
});

test("loadSuggestedWorktreeSessions は session 内で対象 worktree の順位が高い session を先に返す", async () => {
  const repoPath = path.join(tempDir, "repo-focus");
  const targetWorktree = path.join(repoPath, ".yuru", "worktrees", "target");
  const sideWorktree = path.join(repoPath, ".yuru", "worktrees", "side");
  const codexSessionsDir = path.join(codexDir, "sessions", "2026", "05", "10");
  fs.mkdirSync(codexSessionsDir, { recursive: true });

  fs.writeFileSync(
    path.join(codexSessionsDir, "focus-shared.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-shared",
          cwd: repoPath,
          timestamp: "2026-05-10T00:00:01.000Z",
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          changes: {
            [path.join(sideWorktree, "file.txt")]: { type: "add" },
          },
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "git status", workdir: targetWorktree }),
        },
      },
    ),
  );
  fs.writeFileSync(
    path.join(codexSessionsDir, "focus-target.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-target",
          cwd: repoPath,
          timestamp: "2026-05-10T00:00:02.000Z",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "git status", workdir: targetWorktree }),
        },
      },
    ),
  );

  const suggestions = await loadSuggestedWorktreeSessions([targetWorktree, sideWorktree]);

  assert.deepEqual(
    suggestions.get(targetWorktree)?.map((session) => session.providerSessionId),
    ["codex-target", "codex-shared"],
  );
  assert.deepEqual(suggestions.get(targetWorktree)?.[0], {
    provider: "codex",
    providerSessionId: "codex-target",
    cwd: repoPath,
    timestamp: Date.parse("2026-05-10T00:00:02.000Z"),
  });
});
