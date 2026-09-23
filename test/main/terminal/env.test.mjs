import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalEnv } from "../../../src/main/terminal/env.ts";

const terminalEnvOptions = {
  apiSocketPath: "/tmp/yuru/run/123.sock",
  repoPath: "/repo",
  yuruCliPath: "/app/scripts/yuru-cli/index.mjs",
  worktreePath: "/repo",
};

test("createTerminalEnv は親プロセスの NO_COLOR を引き継がない", () => {
  const env = createTerminalEnv(
    {
      HOME: "/tmp/example",
      NO_COLOR: "1",
      TERM: "dumb",
    },
    terminalEnvOptions,
  );

  assert.equal(env.NO_COLOR, undefined);
  assert.equal(env.TERM, "xterm-256color");
  assert.equal(env.COLORTERM, "truecolor");
  assert.equal(env.HOME, "/tmp/example");
});

test("createTerminalEnv は既存の COLORTERM を維持する", () => {
  const env = createTerminalEnv(
    {
      COLORTERM: "24bit",
    },
    terminalEnvOptions,
  );

  assert.equal(env.COLORTERM, "24bit");
});

test("createTerminalEnv は親の Claude セッションの子セッションマーカーを渡さない", () => {
  const env = createTerminalEnv(
    {
      HOME: "/tmp/example",
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CODE_SESSION_ID: "parent-session",
      CLAUDE_CODE_EXECPATH: "/parent/claude",
      CLAUDE_CODE_SSE_PORT: "12345",
    },
    terminalEnvOptions,
  );

  assert.equal(env.HOME, "/tmp/example");
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.CLAUDE_CODE_CHILD_SESSION, undefined);
  assert.equal(env.CLAUDE_CODE_ENTRYPOINT, undefined);
  assert.equal(env.CLAUDE_CODE_SESSION_ID, undefined);
  assert.equal(env.CLAUDE_CODE_EXECPATH, undefined);
  assert.equal(env.CLAUDE_CODE_SSE_PORT, undefined);
});

test("createTerminalEnv は Codex 起動時に親の Codex thread/session 情報を渡さない", () => {
  const env = createTerminalEnv(
    {
      CODEX_HOME: "/tmp/codex-home",
      CODEX_THREAD_ID: "parent-thread",
      CODEX_SESSION_ID: "parent-session",
      CODEX_CONVERSATION_ID: "parent-conversation",
    },
    {
      ...terminalEnvOptions,
      provider: "codex",
    },
  );

  assert.equal(env.CODEX_HOME, "/tmp/codex-home");
  assert.equal(env.CODEX_THREAD_ID, undefined);
  assert.equal(env.CODEX_SESSION_ID, undefined);
  assert.equal(env.CODEX_CONVERSATION_ID, undefined);
});

test("createTerminalEnv は Devin 起動時に親の session 由来の設定を渡さない", () => {
  const env = createTerminalEnv(
    {
      AI_AGENT: "devin_3000-11-1_agent",
      CHISEL_SESSION_DB: "/tmp/parent-sessions.db",
      DEVIN_MODEL: "swe-2-high",
      DEVIN_PERMISSION_MODE: "dangerous",
      DEVIN_SANDBOX: "1",
    },
    {
      ...terminalEnvOptions,
      provider: "devin",
    },
  );

  assert.equal(env.AI_AGENT, undefined);
  assert.equal(env.DEVIN_MODEL, undefined);
  assert.equal(env.DEVIN_PERMISSION_MODE, undefined);
  assert.equal(env.DEVIN_SANDBOX, undefined);
  // session store の場所は Yuru の読む側と子の書く側で一致させるため残す
  assert.equal(env.CHISEL_SESSION_DB, "/tmp/parent-sessions.db");
});

test("createTerminalEnv は Devin 起動でも親が devin session でなければユーザーの DEVIN_* 設定を残す", () => {
  for (const parentEnv of [{}, { AI_AGENT: "claude-code_2.0_agent" }]) {
    const env = createTerminalEnv(
      {
        ...parentEnv,
        DEVIN_MODEL: "swe-2-high",
        DEVIN_PERMISSION_MODE: "accept-edits",
      },
      {
        ...terminalEnvOptions,
        provider: "devin",
      },
    );

    assert.equal(env.DEVIN_MODEL, "swe-2-high");
    assert.equal(env.DEVIN_PERMISSION_MODE, "accept-edits");
  }
});

test("createTerminalEnv は他 provider の起動では Devin の設定をそのまま渡す", () => {
  const env = createTerminalEnv(
    {
      DEVIN_PERMISSION_MODE: "dangerous",
    },
    {
      ...terminalEnvOptions,
      provider: "claude",
    },
  );

  assert.equal(env.DEVIN_PERMISSION_MODE, "dangerous");
});

test("createTerminalEnv は provider を問わず親 agent の AI_AGENT マーカーを渡さない", () => {
  for (const provider of ["claude", "codex", "kimi", "devin"]) {
    const env = createTerminalEnv(
      { AI_AGENT: "devin_3000-11-1_agent" },
      { ...terminalEnvOptions, provider },
    );
    assert.equal(env.AI_AGENT, undefined, provider);
  }
});

test("createTerminalEnv は Yuru API と CLI と repo / worktree の位置を注入する", () => {
  const env = createTerminalEnv(
    {},
    {
      ...terminalEnvOptions,
      repoPath: "/repo",
      worktreePath: "/repo/.yuru/worktrees/task-a",
    },
  );

  assert.equal(env.YURU_API_SOCKET, terminalEnvOptions.apiSocketPath);
  assert.equal(env.YURU_CLI, terminalEnvOptions.yuruCliPath);
  assert.equal(env.YURU_REPO_PATH, "/repo");
  assert.equal(env.YURU_WORKTREE_PATH, "/repo/.yuru/worktrees/task-a");
});

test("createTerminalEnv は main worktree でも現在の repo / worktree 情報で親の値を上書きする", () => {
  const env = createTerminalEnv(
    {
      YURU_REPO_PATH: "/parent",
      YURU_WORKTREE_PATH: "/parent/.yuru/worktrees/parent-task",
    },
    terminalEnvOptions,
  );

  assert.equal(env.YURU_REPO_PATH, "/repo");
  assert.equal(env.YURU_WORKTREE_PATH, "/repo");
});
