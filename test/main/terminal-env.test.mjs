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
