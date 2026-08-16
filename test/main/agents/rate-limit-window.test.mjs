import assert from "node:assert/strict";
import test from "node:test";

import {
  exhaustedUntil,
  isRateLimitResetDue,
  nextResetDelayMs,
} from "../../../src/main/agents/rate-limit-window.ts";

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

test("does not treat lower utilization as a reset before the scheduled time", () => {
  const resetsAt = 90_000;
  assert.equal(exhaustedUntil(ok({ fiveHour: window(98, resetsAt) })), undefined);
  assert.equal(isRateLimitResetDue(resetsAt, 89_999), false);
});

test("treats the scheduled time itself as the reset", () => {
  assert.equal(isRateLimitResetDue(90_000, 90_000), true);
});

test("does not infer a reset when its time is unknown", () => {
  assert.equal(isRateLimitResetDue(null, 90_000), false);
});

test("waits until the earliest reset among the waiting sessions", () => {
  assert.equal(nextResetDelayMs([90_000, 30_000], 10_000), 20_000);
});

test("runs reset handling immediately when the reset time has already passed", () => {
  assert.equal(nextResetDelayMs([5_000], 10_000), 0);
});

test("does not schedule anything when no session is waiting", () => {
  assert.equal(nextResetDelayMs([], 10_000), null);
});

test("does not schedule anything when no reset time is known", () => {
  assert.equal(nextResetDelayMs([null, null], 10_000), null);
});
