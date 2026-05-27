import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShellExecCommand,
  buildShellStartupCommand,
  createInteractiveShellLaunchCommand,
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

test("buildShellStartupCommand は exec 失敗時に shell を終了する", () => {
  assert.equal(
    buildShellStartupCommand("codex", ["resume", "session 1"]),
    "exec 'codex' 'resume' 'session 1' || exit $?",
  );
});

test("createInteractiveShellLaunchCommand はログイン対話シェルを起動する", () => {
  const result = createInteractiveShellLaunchCommand({ SHELL: "/bin/zsh" });

  assert.deepEqual(result, {
    command: "/bin/zsh",
    args: ["-i", "-l"],
  });
});
