import assert from "node:assert/strict";
import test from "node:test";

import {
  detectClaudeWorktreeSession,
  detectCodexWorktreeSession,
  resolveContainingWorktreePath,
} from "../../src/main/worktree-session-detection.ts";

function jsonl(...entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

test("resolveContainingWorktreePath は path boundary を守って最も深い worktree を返す", () => {
  assert.equal(
    resolveContainingWorktreePath("/repo/.yuru/worktrees/task-a/src", [
      "/repo/.yuru/worktrees/task",
      "/repo/.yuru/worktrees/task-a",
    ]),
    "/repo/.yuru/worktrees/task-a",
  );
  assert.equal(
    resolveContainingWorktreePath("/repo/.yuru/worktrees/task-a-sibling", [
      "/repo/.yuru/worktrees/task-a",
    ]),
    null,
  );
});

test("detectClaudeWorktreeSession は worktree-state の worktreePath を強い hint として読む", () => {
  const hint = detectClaudeWorktreeSession(
    jsonl({
      type: "worktree-state",
      sessionId: "claude-session",
      worktreeSession: {
        worktreePath: "/repo/.claude/worktrees/task-a",
      },
    }),
    [],
  );

  assert.deepEqual(hint, {
    provider: "claude",
    providerSessionId: "claude-session",
    worktreePath: "/repo/.claude/worktrees/task-a",
    source: "claude-worktree-state",
  });
});

test("detectClaudeWorktreeSession は cwd が既知 worktree 配下なら fallback hint として読む", () => {
  const hint = detectClaudeWorktreeSession(
    jsonl({
      type: "user",
      sessionId: "claude-session",
      cwd: "/repo/.claude/worktrees/task-a/src",
    }),
    ["/repo/.claude/worktrees/task-a"],
  );

  assert.deepEqual(hint, {
    provider: "claude",
    providerSessionId: "claude-session",
    worktreePath: "/repo/.claude/worktrees/task-a",
    source: "claude-cwd",
  });
});

test("detectCodexWorktreeSession は session_meta.cwd を primary hint として読む", () => {
  const hint = detectCodexWorktreeSession(
    jsonl({
      type: "session_meta",
      payload: {
        id: "codex-session",
        cwd: "/repo/.yuru/worktrees/task-a",
      },
    }),
    ["/repo/.yuru/worktrees/task-a"],
  );

  assert.deepEqual(hint, {
    provider: "codex",
    providerSessionId: "codex-session",
    worktreePath: "/repo/.yuru/worktrees/task-a",
    source: "codex-session-meta",
  });
});

test("detectCodexWorktreeSession は exec_command_end.cwd を fallback hint として読み turn_context.cwd は無視する", () => {
  const hint = detectCodexWorktreeSession(
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-session",
          cwd: "/repo",
        },
      },
      {
        type: "turn_context",
        payload: {
          cwd: "/repo/.yuru/worktrees/noisy-task",
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          cwd: "/repo/.yuru/worktrees/task-a/src",
        },
      },
    ),
    ["/repo/.yuru/worktrees/task-a", "/repo/.yuru/worktrees/noisy-task"],
  );

  assert.deepEqual(hint, {
    provider: "codex",
    providerSessionId: "codex-session",
    worktreePath: "/repo/.yuru/worktrees/task-a",
    source: "codex-exec-command-end",
  });
});
