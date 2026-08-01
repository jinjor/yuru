import assert from "node:assert/strict";
import test from "node:test";

import { deliverInitialInput } from "../../src/main/initial-input.ts";

test("テキストと Enter を別 write で送る", async () => {
  const writes = [];
  const delivered = await deliverInitialInput(
    { write: (data) => writes.push(data) },
    "hello",
    { enterDelayMs: 1 },
  );

  assert.equal(delivered, true);
  assert.deepEqual(writes, ["\u001b[200~hello\u001b[201~", "\r"]);
});

test("verify が記録を確認できれば true を返す", async () => {
  const writes = [];
  let verifyCalls = 0;
  const delivered = await deliverInitialInput(
    { write: (data) => writes.push(data) },
    "hello",
    {
      enterDelayMs: 1,
      verifyPollIntervalMs: 1,
      verifyTimeoutMs: 100,
      verify: async () => {
        verifyCalls += 1;
        return verifyCalls >= 2;
      },
    },
  );

  assert.equal(delivered, true);
  assert.ok(verifyCalls >= 2);
  assert.deepEqual(writes, ["\u001b[200~hello\u001b[201~", "\r"]);
});

test("verify が timeout すれば false を返す", async () => {
  const delivered = await deliverInitialInput(
    { write: () => {} },
    "hello",
    {
      enterDelayMs: 1,
      verifyPollIntervalMs: 1,
      verifyTimeoutMs: 20,
      verify: async () => false,
    },
  );

  assert.equal(delivered, false);
});

test("複数行 Markdown は一つの bracketed paste として送る", async () => {
  const writes = [];
  const input = "# Handoff\n\n- Review\n- Implement\n";

  await deliverInitialInput({ write: (data) => writes.push(data) }, input, { enterDelayMs: 1 });

  assert.deepEqual(writes, [`\u001b[200~${input}\u001b[201~`, "\r"]);
});

test("端末制御文字は write 前に拒否する", async () => {
  for (const controlCharacter of ["\r", "\u001b", "\u0003", "\u007f", "\u0085"]) {
    const writes = [];
    await assert.rejects(
      deliverInitialInput(
        { write: (data) => writes.push(data) },
        `before${controlCharacter}after`,
        { enterDelayMs: 1 },
      ),
      /no other terminal control characters/,
    );
    assert.deepEqual(writes, []);
  }
});

test("tab と line feed は通常テキストとして許可する", async () => {
  const writes = [];
  const input = "heading\n\titem";

  await deliverInitialInput({ write: (data) => writes.push(data) }, input, { enterDelayMs: 1 });

  assert.deepEqual(writes, [`\u001b[200~${input}\u001b[201~`, "\r"]);
});
