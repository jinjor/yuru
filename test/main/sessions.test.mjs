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
const runtimeProject = path.join(tempDir, "live-worktree");
fs.mkdirSync(claudeDir, { recursive: true });
fs.mkdirSync(codexDir, { recursive: true });
fs.mkdirSync(runtimeProject, { recursive: true });
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

test("loadSessions は active runtime の cwd を snapshot project より優先する", async () => {
  const sessionKey = toSessionKey("claude", "claude-1");
  const sessions = await loadSessions(
    new Map([
      [
        sessionKey,
        {
          cwd: runtimeProject,
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
  assert.equal(sessions[0].project, runtimeProject);
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
      sessionCwd: repoRoot,
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
    { provider: "claude", providerSessionId: "claude-a" },
    { provider: "claude", providerSessionId: "claude-b" },
    { provider: "codex", providerSessionId: "codex-a" },
  ]);
  assert.deepEqual(suggestions.get(worktreeB), [
    { provider: "claude", providerSessionId: "claude-a" },
    { provider: "codex", providerSessionId: "codex-b" },
  ]);
});
