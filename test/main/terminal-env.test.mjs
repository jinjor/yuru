import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalEnv } from "../../src/main/terminal-env.ts";

test("createTerminalEnv は親プロセスの NO_COLOR を引き継がない", () => {
  const env = createTerminalEnv({
    HOME: "/tmp/example",
    NO_COLOR: "1",
    TERM: "dumb",
  });

  assert.equal(env.NO_COLOR, undefined);
  assert.equal(env.TERM, "xterm-256color");
  assert.equal(env.COLORTERM, "truecolor");
  assert.equal(env.HOME, "/tmp/example");
});

test("createTerminalEnv は既存の COLORTERM を維持する", () => {
  const env = createTerminalEnv({
    COLORTERM: "24bit",
  });

  assert.equal(env.COLORTERM, "24bit");
});

test("createTerminalEnv は親の Claude セッションの子セッションマーカーを渡さない", () => {
  const env = createTerminalEnv({
    HOME: "/tmp/example",
    CLAUDECODE: "1",
    CLAUDE_CODE_CHILD_SESSION: "1",
    CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_SESSION_ID: "parent-session",
    CLAUDE_CODE_EXECPATH: "/parent/claude",
    CLAUDE_CODE_SSE_PORT: "12345",
  });

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
    "codex",
  );

  assert.equal(env.CODEX_HOME, "/tmp/codex-home");
  assert.equal(env.CODEX_THREAD_ID, undefined);
  assert.equal(env.CODEX_SESSION_ID, undefined);
  assert.equal(env.CODEX_CONVERSATION_ID, undefined);
});
