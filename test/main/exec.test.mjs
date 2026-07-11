import assert from "node:assert/strict";
import test from "node:test";

import { exec, execBuffer } from "../../src/main/exec.ts";

const cwd = process.cwd();

test("exec は 10MB を超える stdout を途中で終了せず返す", async () => {
  const outputSize = 10 * 1024 * 1024 + 1;
  const output = await exec(
    process.execPath,
    ["-e", `process.stdout.write("x".repeat(${outputSize}))`],
    cwd,
  );

  assert.equal(Buffer.byteLength(output), outputSize);
});

test("execBuffer はバイナリの stdout をそのまま返す", async () => {
  const output = await execBuffer(
    process.execPath,
    ["-e", "process.stdout.write(Buffer.from([0, 255, 1]))"],
    cwd,
  );

  assert.deepEqual(output, Buffer.from([0, 255, 1]));
});

test("exec は失敗したコマンドの stderr と終了コードを返す", async () => {
  await assert.rejects(
    () =>
      exec(
        process.execPath,
        ["-e", 'process.stderr.write("failed detail\\n"); process.exit(7)'],
        cwd,
      ),
    (error) => error.message === "failed detail" && error.code === 7,
  );
});

test("exec は存在しないコマンドの ENOENT を保つ", async () => {
  await assert.rejects(
    () => exec("__yuru_missing_command__", [], cwd),
    (error) => error.code === "ENOENT",
  );
});
