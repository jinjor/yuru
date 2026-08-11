import assert from "node:assert/strict";
import test from "node:test";

import { detectClaudeWorktreeSession } from "../../../src/main/agents/claude/session-detection.ts";
import {
  detectCodexWorktreeSession,
  detectCodexWorktreeSessions,
} from "../../../src/main/agents/codex/session-detection.ts";
import {
  detectKimiMentionHints,
  detectKimiWorkDirHint,
} from "../../../src/main/agents/kimi/session-detection.ts";
import {
  resolveContainingWorktreePath,
  resolveMentionedWorktreePaths,
} from "../../../src/main/agents/session-detection.ts";

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

test("resolveMentionedWorktreePaths は path boundary を守って絶対 path の言及を返す", () => {
  assert.deepEqual(
    resolveMentionedWorktreePaths("updated /repo/.yuru/worktrees/task-a/src/file.ts", [
      "/repo/.yuru/worktrees/task",
      "/repo/.yuru/worktrees/task-a",
    ]),
    ["/repo/.yuru/worktrees/task-a"],
  );
  assert.deepEqual(
    resolveMentionedWorktreePaths("updated /repo/.yuru/worktrees/task-a-sibling/file.ts", [
      "/repo/.yuru/worktrees/task-a",
    ]),
    [],
  );
});

test("detectClaudeWorktreeSession は worktree-state を hint として読まない", () => {
  const hint = detectClaudeWorktreeSession(
    jsonl({
      type: "worktree-state",
      sessionId: "claude-session",
      worktreeSession: {
        worktreePath: "/repo/.claude/worktrees/task-a",
      },
    }),
    ["/repo/.claude/worktrees/task-a"],
  );

  assert.equal(hint, null);
});

test("detectClaudeWorktreeSession は cwd が既知 worktree 配下なら hint として読む", () => {
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
    agentSessionId: "claude-session",
    worktreePath: "/repo/.claude/worktrees/task-a",
    worktreeRank: 0,
  });
});

test("detectClaudeWorktreeSession は tool_use の file_path を弱い hint として読む", () => {
  const hint = detectClaudeWorktreeSession(
    jsonl({
      type: "assistant",
      sessionId: "claude-session",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: {
              file_path: "/repo/.claude/worktrees/task-a/src/file.ts",
            },
          },
        ],
      },
    }),
    ["/repo/.claude/worktrees/task-a"],
  );

  assert.deepEqual(hint, {
    provider: "claude",
    agentSessionId: "claude-session",
    worktreePath: "/repo/.claude/worktrees/task-a",
    worktreeRank: 0,
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
    agentSessionId: "codex-session",
    worktreePath: "/repo/.yuru/worktrees/task-a",
    worktreeRank: 0,
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
    agentSessionId: "codex-session",
    worktreePath: "/repo/.yuru/worktrees/task-a",
    worktreeRank: 0,
  });
});

test("detectCodexWorktreeSessions は 0.130 の function_call.arguments.workdir を読む", () => {
  const hints = detectCodexWorktreeSessions(
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-session",
          cwd: "/repo",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({
            cmd: "pwd",
            workdir: "/repo/.yuru/worktrees/task-a",
          }),
        },
      },
    ),
    ["/repo/.yuru/worktrees/task-a"],
  );

  assert.deepEqual(hints, [
    {
      provider: "codex",
      agentSessionId: "codex-session",
      worktreePath: "/repo/.yuru/worktrees/task-a",
      worktreeRank: 0,
    },
  ]);
});

test("detectCodexWorktreeSessions は patch_apply_end.changes を読む", () => {
  const hints = detectCodexWorktreeSessions(
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-session",
          cwd: "/repo",
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          changes: {
            "/repo/.yuru/worktrees/task-a/src/file.ts": {
              type: "add",
            },
          },
        },
      },
    ),
    ["/repo/.yuru/worktrees/task-a"],
  );

  assert.deepEqual(hints, [
    {
      provider: "codex",
      agentSessionId: "codex-session",
      worktreePath: "/repo/.yuru/worktrees/task-a",
      worktreeRank: 0,
    },
  ]);
});

test("detectCodexWorktreeSessions は 0.147 の event_msg item_completed CommandExecution.cwd (file URL) を読む", () => {
  const hints = detectCodexWorktreeSessions(
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-session",
          cwd: "/repo",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "exec",
          input:
            'const r = await tools.exec_command({ cmd: "pwd", workdir: "/repo/.yuru/worktrees/task-a" });',
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: {
            type: "CommandExecution",
            cwd: "file:///repo/.yuru/worktrees/task-a",
          },
        },
      },
    ),
    ["/repo/.yuru/worktrees/task-a"],
  );

  assert.deepEqual(hints, [
    {
      provider: "codex",
      agentSessionId: "codex-session",
      worktreePath: "/repo/.yuru/worktrees/task-a",
      worktreeRank: 0,
    },
  ]);
});

test("detectCodexWorktreeSessions は 0.147 の item_completed CommandExecution.cwd が file URL でなければ無視する", () => {
  const hints = detectCodexWorktreeSessions(
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-session",
          cwd: "/repo",
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: {
            type: "CommandExecution",
            cwd: "/repo/.yuru/worktrees/task-a",
          },
        },
      },
    ),
    ["/repo/.yuru/worktrees/task-a"],
  );

  assert.deepEqual(hints, []);
});

test("detectCodexWorktreeSessions は 0.147 の event_msg item_completed FileChange.changes を読む", () => {
  const hints = detectCodexWorktreeSessions(
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-session",
          cwd: "/repo",
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: {
            type: "FileChange",
            changes: {
              "/repo/.yuru/worktrees/task-a/src/file.ts": {
                type: "update",
              },
            },
          },
        },
      },
    ),
    ["/repo/.yuru/worktrees/task-a"],
  );

  assert.deepEqual(hints, [
    {
      provider: "codex",
      agentSessionId: "codex-session",
      worktreePath: "/repo/.yuru/worktrees/task-a",
      worktreeRank: 0,
    },
  ]);
});

test("detectCodexWorktreeSessions は session 内の worktreeRank を provider 側で決める", () => {
  const metaWorktree = "/repo/.yuru/worktrees/meta";
  const patchWorktree = "/repo/.yuru/worktrees/patch";
  const oldCwdWorktree = "/repo/.yuru/worktrees/old-cwd";
  const newCwdWorktree = "/repo/.yuru/worktrees/new-cwd";
  const textWorktree = "/repo/.yuru/worktrees/text";
  const hints = detectCodexWorktreeSessions(
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-session",
          cwd: metaWorktree,
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pwd", workdir: oldCwdWorktree }),
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pwd", workdir: newCwdWorktree }),
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          changes: {
            [`${patchWorktree}/src/file.ts`]: { type: "add" },
          },
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          content: [{ type: "output_text", text: `Created ${textWorktree}` }],
        },
      },
    ),
    [metaWorktree, patchWorktree, oldCwdWorktree, newCwdWorktree, textWorktree],
  );

  assert.deepEqual(
    hints.map((hint) => ({
      worktreePath: hint.worktreePath,
      worktreeRank: hint.worktreeRank,
    })),
    [
      { worktreePath: metaWorktree, worktreeRank: 0 },
      { worktreePath: patchWorktree, worktreeRank: 1 },
      { worktreePath: newCwdWorktree, worktreeRank: 2 },
      { worktreePath: oldCwdWorktree, worktreeRank: 3 },
    ],
  );
});

test("detectCodexWorktreeSessions は既知 worktree の絶対 path 文字列だけでは hint にしない", () => {
  const hints = detectCodexWorktreeSessions(
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-session",
          cwd: "/repo",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Created /repo/.yuru/worktrees/task-a",
            },
          ],
        },
      },
    ),
    ["/repo/.yuru/worktrees/task-a"],
  );

  assert.deepEqual(hints, []);
});


test("detectKimiWorkDirHint は workDir が一致する worktree を rank 0 で返す", () => {
  const ref = {
    agentSessionId: "session_1",
    sessionDir: "/store/session_1",
    workDir: "/repo/.yuru/worktrees/task-a",
  };

  assert.deepEqual(detectKimiWorkDirHint(ref, ["/repo", "/repo/.yuru/worktrees/task-a"]), {
    provider: "kimi",
    agentSessionId: "session_1",
    worktreePath: "/repo/.yuru/worktrees/task-a",
    worktreeRank: 0,
  });
});

test("detectKimiWorkDirHint は worktree のサブディレクトリもその worktree に帰属させる", () => {
  const ref = {
    agentSessionId: "session_1",
    sessionDir: "/store/session_1",
    workDir: "/repo/.yuru/worktrees/task-a/src",
  };

  assert.deepEqual(
    detectKimiWorkDirHint(ref, ["/repo/.yuru/worktrees/task-a"])?.worktreePath,
    "/repo/.yuru/worktrees/task-a",
  );
});

test("detectKimiWorkDirHint はどの worktree にも属さなければ null を返す", () => {
  const ref = {
    agentSessionId: "session_1",
    sessionDir: "/store/session_1",
    workDir: "/elsewhere",
  };

  assert.equal(detectKimiWorkDirHint(ref, ["/repo/.yuru/worktrees/task-a"]), null);
});

test("detectKimiMentionHints は注入プロンプトの言及から worktree を rank 1 で返す", () => {
  const ref = {
    agentSessionId: "session_2",
    sessionDir: "/store/session_2",
    workDir: "/repo",
  };
  const promptLine =
    "Yuru opened this session for the task worktree 'task-a' on branch 'feature/task-a'. " +
    "Use /repo/.yuru/worktrees/task-a as the working directory for this task.";

  assert.deepEqual(detectKimiMentionHints(ref, [promptLine], ["/repo/.yuru/worktrees/task-a"]), [
    {
      provider: "kimi",
      agentSessionId: "session_2",
      worktreePath: "/repo/.yuru/worktrees/task-a",
      worktreeRank: 1,
    },
  ]);
  assert.deepEqual(detectKimiMentionHints(ref, ["no path here"], ["/repo/.yuru/worktrees/task-a"]), []);
});

test("detectKimiMentionHints は注入マーカーのない行の path 言及を hint にしない", () => {
  const ref = {
    agentSessionId: "session_2",
    sessionDir: "/store/session_2",
    workDir: "/repo",
  };

  assert.deepEqual(
    detectKimiMentionHints(
      ref,
      ["Updated /repo/.yuru/worktrees/task-a/src/file.ts as discussed"],
      ["/repo/.yuru/worktrees/task-a"],
    ),
    [],
  );
});
