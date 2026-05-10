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
fs.mkdirSync(claudeDir, { recursive: true });
fs.mkdirSync(codexDir, { recursive: true });
fs.writeFileSync(
  path.join(claudeDir, "history.jsonl"),
  `${JSON.stringify({
    sessionId: "claude-1",
    project: staleProject,
    display: "last message",
    timestamp: 1000,
  })}\n`,
);

const {
  loadSessions,
  loadStoredSessionPreviews,
  loadSuggestedWorktreeSessions,
} = await import("../../src/main/sessions.ts");
const { sessionProvider: codexProvider } = await import("../../src/main/agents/codex/index.ts");
const { toSessionKey } = await import("../../src/shared/session.ts");

function jsonl(...entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

test.after(() => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("loadSessions は active runtime を provider session key で snapshot に重ねる", async () => {
  const sessionKey = toSessionKey("claude", "claude-1");
  const sessions = await loadSessions(
    new Map([
      [
        sessionKey,
        {
          provider: "claude",
          providerSessionId: "claude-1",
          startedAt: 2000,
        },
      ],
    ]),
  );

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, sessionKey);
  assert.equal(sessions[0].state, "active");
  assert.equal(sessions[0].project, staleProject);
});

test("loadStoredSessionPreviews は stored session の preview を key で返す", async () => {
  const previews = await loadStoredSessionPreviews();

  assert.equal(previews.get(toSessionKey("claude", "claude-1")), "last message");
});

test("Codex resume launch は repo root で起動する", async () => {
  const repoRoot = path.join(tempDir, "repo");
  const worktreePath = path.join(repoRoot, ".yuru", "worktrees", "task-a");

  assert.deepEqual(
    await codexProvider.createResumeLaunch({
      provider: "codex",
      providerSessionId: "codex-resume",
      repoPath: repoRoot,
      project: worktreePath,
    }),
    {
      cwd: repoRoot,
      args: ["resume", "codex-resume"],
      worktreePath: repoRoot,
    },
  );
});

test("loadSuggestedWorktreeSessions は suggested session を worktree ごとに dedup して並べる", async () => {
  const projectsDir = path.join(claudeDir, "projects", "repo");
  fs.mkdirSync(projectsDir, { recursive: true });
  const worktreeA = path.join(tempDir, "repo", ".claude", "worktrees", "task-a");
  const worktreeB = path.join(tempDir, "repo", ".claude", "worktrees", "task-b");
  fs.writeFileSync(
    path.join(projectsDir, "b.jsonl"),
    jsonl({
      type: "worktree-state",
      sessionId: "claude-b",
      worktreeSession: { worktreePath: worktreeA },
    }),
  );
  fs.writeFileSync(
    path.join(projectsDir, "a.jsonl"),
    jsonl({
      type: "worktree-state",
      sessionId: "claude-a",
      worktreeSession: { worktreePath: worktreeA },
    }),
  );
  fs.writeFileSync(
    path.join(projectsDir, "a-duplicate.jsonl"),
    jsonl({
      type: "worktree-state",
      sessionId: "claude-a",
      worktreeSession: { worktreePath: worktreeA },
    }),
  );
  fs.writeFileSync(
    path.join(projectsDir, "other-worktree.jsonl"),
    jsonl({
      type: "worktree-state",
      sessionId: "claude-a",
      worktreeSession: { worktreePath: worktreeB },
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
    { provider: "claude", providerSessionId: "claude-a", timestamp: 0 },
    { provider: "claude", providerSessionId: "claude-b", timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-a", timestamp: 0 },
  ]);
  assert.deepEqual(suggestions.get(worktreeB), [
    { provider: "claude", providerSessionId: "claude-a", timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-b", timestamp: 0 },
  ]);
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
    { provider: "codex", providerSessionId: "codex-meta", timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-patch", timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-weak", timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-workdir", timestamp: 0 },
  ]);
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
    timestamp: Date.parse("2026-05-10T00:00:02.000Z"),
  });
});
