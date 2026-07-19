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
  assert.deepEqual(writes, ["hello", "\r"]);
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
  assert.deepEqual(writes, ["hello", "\r"]);
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
