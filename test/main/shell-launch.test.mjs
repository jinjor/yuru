import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShellExecCommand,
  createShellLaunchCommand,
  shellQuote,
} from "../../src/main/shell-launch.ts";

test("shellQuote は single quote を shell 用に escape する", () => {
  assert.equal(shellQuote("it's ok"), "'it'\\''s ok'");
});

test("buildShellExecCommand は command と args を exec に渡す", () => {
  assert.equal(
    buildShellExecCommand("codex", ["resume", "session 1"]),
    "exec 'codex' 'resume' 'session 1'",
  );
});

test("createShellLaunchCommand はログイン対話シェル経由で command を起動する", () => {
  const result = createShellLaunchCommand("codex", ["resume", "session-1"], {
    SHELL: "/bin/zsh",
  });

  assert.deepEqual(result, {
    command: "/bin/zsh",
    args: ["-i", "-l", "-c", "exec 'codex' 'resume' 'session-1'"],
  });
});
