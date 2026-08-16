import assert from "node:assert/strict";
import test from "node:test";

import { exhaustedUntil, nextRecheckDelayMs } from "../../../src/main/agents/rate-limit-window.ts";

function ok({ fiveHour = null, weekly = null } = {}) {
  return { provider: "kimi", state: "ok", fiveHour, weekly, fetchedAt: 0 };
}

function window(usedPercent, resetsAt = null) {
  return { usedPercent, resetsAt };
}

test("a provider below every limit is not exhausted", () => {
  assert.equal(exhaustedUntil(ok({ fiveHour: window(99), weekly: window(40) })), undefined);
});

test("waits for the last of the exhausted windows to reset", () => {
  // どちらか 1 つでも埋まっていればリクエストは通らない。
  assert.equal(
    exhaustedUntil(ok({ fiveHour: window(100, 10_000), weekly: window(100, 90_000) })),
    90_000,
  );
});

test("ignores the reset time of a window that is not exhausted", () => {
  assert.equal(exhaustedUntil(ok({ fiveHour: window(100, 10_000), weekly: window(40, 90_000) })), 10_000);
});

test("reports an exhausted window with no reset time as unknown", () => {
  assert.equal(exhaustedUntil(ok({ weekly: window(100, null) })), null);
});

test("a provider that reports no usage is not exhausted", () => {
  assert.equal(exhaustedUntil({ provider: "claude", state: "logged-out" }), undefined);
});

test("waits until the earliest reset among the waiting sessions", () => {
  assert.equal(nextRecheckDelayMs([90_000, 30_000], 10_000), 20_000);
});

test("spaces out the next check when the reset time has already passed", () => {
  // 過ぎた時刻へ張り直し続けると取り直しが止まらなくなる。
  assert.equal(nextRecheckDelayMs([5_000], 10_000), 60_000);
});

test("does not schedule anything when no session is waiting", () => {
  assert.equal(nextRecheckDelayMs([], 10_000), null);
});

test("does not schedule anything when no reset time is known", () => {
  assert.equal(nextRecheckDelayMs([null, null], 10_000), null);
});
