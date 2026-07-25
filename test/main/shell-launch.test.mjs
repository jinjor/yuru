import assert from "node:assert/strict";
import test from "node:test";

import { createInteractiveShellLaunchCommand } from "../../src/main/shell-launch.ts";

test("createInteractiveShellLaunchCommand はログイン対話シェルを起動する", () => {
  const result = createInteractiveShellLaunchCommand({ SHELL: "/bin/zsh" });

  assert.deepEqual(result, {
    command: "/bin/zsh",
    args: ["-i", "-l"],
  });
});

test("createInteractiveShellLaunchCommand は startup command を shell の引数として渡す", () => {
  const result = createInteractiveShellLaunchCommand(
    { SHELL: "/bin/zsh" },
    { command: "codex", args: ["resume", "session 1"] },
  );

  assert.deepEqual(result, {
    command: "/bin/zsh",
    args: ["-i", "-l", "-c", "exec 'codex' 'resume' 'session 1'"],
  });
});

test("createInteractiveShellLaunchCommand は single quote を含む引数を escape する", () => {
  const result = createInteractiveShellLaunchCommand(
    { SHELL: "/bin/zsh" },
    { command: "claude", args: ["--append-system-prompt", "it's ok"] },
  );

  assert.equal(result.args.at(-1), "exec 'claude' '--append-system-prompt' 'it'\\''s ok'");
});

// 端末入力は 1 行 1024 バイトで切り捨てられるため、長い prompt は引数で渡す必要がある。
test("createInteractiveShellLaunchCommand は 1024 バイトを超える引数をそのまま渡す", () => {
  const prompt = "a".repeat(4000);
  const result = createInteractiveShellLaunchCommand(
    { SHELL: "/bin/zsh" },
    { command: "claude", args: ["--append-system-prompt", prompt] },
  );

  assert.ok(result.args.at(-1).includes(prompt));
});
