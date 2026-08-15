import assert from "node:assert/strict";
import test from "node:test";

import { RateLimitRecovery } from "../../../src/main/agents/rate-limit-recovery.ts";

function ok(provider, { fiveHour = null, weekly = null } = {}) {
  return { provider, state: "ok", fiveHour, weekly, fetchedAt: 0 };
}

function window(usedPercent) {
  return { usedPercent, resetsAt: null };
}

function createRecovery() {
  const recovered = [];
  return { recovered, recovery: new RateLimitRecovery((provider) => recovered.push(provider)) };
}

test("reports recovery when an exhausted window drops back below the limit", () => {
  const { recovered, recovery } = createRecovery();

  recovery.update([ok("kimi", { weekly: window(100) })]);
  assert.deepEqual(recovered, []);

  recovery.update([ok("kimi", { weekly: window(0) })]);
  assert.deepEqual(recovered, ["kimi"]);
});

test("reports recovery once per exhaustion", () => {
  const { recovered, recovery } = createRecovery();

  recovery.update([ok("kimi", { weekly: window(100) })]);
  recovery.update([ok("kimi", { weekly: window(0) })]);
  recovery.update([ok("kimi", { weekly: window(1) })]);

  assert.deepEqual(recovered, ["kimi"]);
});

test("does not report a provider that was never exhausted", () => {
  const { recovered, recovery } = createRecovery();

  recovery.update([ok("claude", { fiveHour: window(99), weekly: window(40) })]);

  assert.deepEqual(recovered, []);
});

test("treats any exhausted window as exhausted", () => {
  const { recovered, recovery } = createRecovery();

  recovery.update([ok("claude", { fiveHour: window(100), weekly: window(40) })]);
  recovery.update([ok("claude", { fiveHour: window(2), weekly: window(41) })]);

  assert.deepEqual(recovered, ["claude"]);
});

test("keeps waiting while the usage cannot be read", () => {
  const { recovered, recovery } = createRecovery();

  recovery.update([ok("kimi", { weekly: window(100) })]);
  recovery.update([{ provider: "kimi", state: "failed" }]);
  assert.deepEqual(recovered, []);

  recovery.update([ok("kimi", { weekly: window(0) })]);
  assert.deepEqual(recovered, ["kimi"]);
});

test("tracks each provider separately", () => {
  const { recovered, recovery } = createRecovery();

  recovery.update([ok("kimi", { weekly: window(100) }), ok("codex", { weekly: window(100) })]);
  recovery.update([ok("kimi", { weekly: window(0) }), ok("codex", { weekly: window(100) })]);

  assert.deepEqual(recovered, ["kimi"]);
});
