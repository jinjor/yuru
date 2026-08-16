import assert from "node:assert/strict";
import test from "node:test";

import { RateLimitRecovery } from "../../../src/main/agents/rate-limit-recovery.ts";

function ok(provider, { fiveHour = null, weekly = null } = {}) {
  return { provider, state: "ok", fiveHour, weekly, fetchedAt: 0 };
}

function window(usedPercent, resetsAt = null) {
  return { usedPercent, resetsAt };
}

function createRecovery({ waiting = true } = {}) {
  const resumed = [];
  const refreshed = [];
  const recovery = new RateLimitRecovery({
    refreshPlanUsage: () => refreshed.push(Date.now()),
    hasWaitingSessions: () => waiting,
    resumeSessions: (provider) => resumed.push(provider),
  });
  return { resumed, refreshed, recovery };
}

test("resumes when an exhausted window drops back below the limit", () => {
  const { resumed, recovery } = createRecovery();

  recovery.update([ok("kimi", { weekly: window(100) })]);
  assert.deepEqual(resumed, []);

  recovery.update([ok("kimi", { weekly: window(0) })]);
  assert.deepEqual(resumed, ["kimi"]);

  recovery.stop();
});

test("resumes once per exhaustion", () => {
  const { resumed, recovery } = createRecovery();

  recovery.update([ok("kimi", { weekly: window(100) })]);
  recovery.update([ok("kimi", { weekly: window(0) })]);
  recovery.update([ok("kimi", { weekly: window(1) })]);

  assert.deepEqual(resumed, ["kimi"]);
  recovery.stop();
});

test("does not resume a provider that was never exhausted", () => {
  const { resumed, recovery } = createRecovery();

  recovery.update([ok("claude", { fiveHour: window(99), weekly: window(40) })]);

  assert.deepEqual(resumed, []);
  recovery.stop();
});

test("treats any exhausted window as exhausted", () => {
  const { resumed, recovery } = createRecovery();

  recovery.update([ok("claude", { fiveHour: window(100), weekly: window(40) })]);
  recovery.update([ok("claude", { fiveHour: window(2), weekly: window(41) })]);

  assert.deepEqual(resumed, ["claude"]);
  recovery.stop();
});

test("keeps waiting while the usage cannot be read", () => {
  const { resumed, recovery } = createRecovery();

  recovery.update([ok("kimi", { weekly: window(100) })]);
  recovery.update([{ provider: "kimi", state: "failed" }]);
  assert.deepEqual(resumed, []);

  recovery.update([ok("kimi", { weekly: window(0) })]);
  assert.deepEqual(resumed, ["kimi"]);
  recovery.stop();
});

test("tracks each provider separately", () => {
  const { resumed, recovery } = createRecovery();

  recovery.update([ok("kimi", { weekly: window(100) }), ok("codex", { weekly: window(100) })]);
  recovery.update([ok("kimi", { weekly: window(0) }), ok("codex", { weekly: window(100) })]);

  assert.deepEqual(resumed, ["kimi"]);
  recovery.stop();
});

test("refreshes the usage at the reset time without waiting for a poll", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { refreshed, recovery } = createRecovery();

  recovery.update([ok("kimi", { weekly: window(100, Date.now() + 60_000) })]);

  t.mock.timers.tick(59_000);
  assert.deepEqual(refreshed.length, 0);

  t.mock.timers.tick(1_000);
  assert.deepEqual(refreshed.length, 1);
  recovery.stop();
});

test("waits for the last of several exhausted windows to reset", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { refreshed, recovery } = createRecovery();

  recovery.update([
    ok("claude", {
      fiveHour: window(100, Date.now() + 10_000),
      weekly: window(100, Date.now() + 90_000),
    }),
  ]);

  t.mock.timers.tick(10_000);
  assert.deepEqual(refreshed.length, 0);

  t.mock.timers.tick(80_000);
  assert.deepEqual(refreshed.length, 1);
  recovery.stop();
});

test("wakes at the earliest reset when several providers are exhausted", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { refreshed, recovery } = createRecovery();

  recovery.update([
    ok("kimi", { weekly: window(100, Date.now() + 90_000) }),
    ok("codex", { weekly: window(100, Date.now() + 30_000) }),
  ]);

  t.mock.timers.tick(30_000);
  assert.deepEqual(refreshed.length, 1);
  recovery.stop();
});

test("retries later when the provider still reports the window as exhausted", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { refreshed, recovery } = createRecovery();

  recovery.update([ok("kimi", { weekly: window(100, Date.now() + 10_000) })]);
  t.mock.timers.tick(10_000);
  assert.deepEqual(refreshed.length, 1);

  // リセット時刻を過ぎても使い切りのままなら、詰めて聞き直さず一定間隔を空ける。
  recovery.update([ok("kimi", { weekly: window(100, Date.now() - 1_000) })]);
  t.mock.timers.tick(59_000);
  assert.deepEqual(refreshed.length, 1);

  t.mock.timers.tick(1_000);
  assert.deepEqual(refreshed.length, 2);
  recovery.stop();
});

test("does not schedule a recheck when the reset time is unknown", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { refreshed, recovery } = createRecovery();

  recovery.update([ok("kimi", { weekly: window(100, null) })]);

  t.mock.timers.tick(24 * 60 * 60_000);
  assert.deepEqual(refreshed.length, 0);
  recovery.stop();
});

test("stops rechecking once the provider recovers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { refreshed, recovery } = createRecovery();

  recovery.update([ok("kimi", { weekly: window(100, Date.now() + 10_000) })]);
  recovery.update([ok("kimi", { weekly: window(0, null) })]);

  t.mock.timers.tick(24 * 60 * 60_000);
  assert.deepEqual(refreshed.length, 0);
  recovery.stop();
});

test("does not schedule a recheck when no session is waiting for the reset", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { refreshed, recovery } = createRecovery({ waiting: false });

  recovery.update([ok("kimi", { weekly: window(100, Date.now() + 10_000) })]);

  t.mock.timers.tick(24 * 60 * 60_000);
  assert.deepEqual(refreshed.length, 0);
  recovery.stop();
});
