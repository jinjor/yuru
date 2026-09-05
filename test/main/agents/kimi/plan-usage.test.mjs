import assert from "node:assert/strict";
import test from "node:test";

import { findFiveHourRow } from "../../../../src/main/agents/kimi/plan-usage.ts";

test("limits の中から 5 時間枠を window の長さで見つける", () => {
  const fiveHour = {
    window: { duration: 5, unit: "hour" },
    used: 6,
    limit: 100,
    reset_at: "2026-09-05T04:37:59.075132Z",
  };
  const weekly = {
    window: { duration: 1, unit: "week" },
    used: 73,
    limit: 100,
    reset_at: "2026-09-05T15:37:59.075132Z",
  };
  assert.equal(findFiveHourRow([weekly, fiveHour]), fiveHour);
});

test("5 時間枠が無い、または形を読めないときは null", () => {
  assert.equal(findFiveHourRow([{ window: { duration: 1, unit: "week" } }]), null);
  // 窓の長さが違う枠は拾わない。
  assert.equal(findFiveHourRow([{ window: { duration: 5, unit: "minute" } }]), null);
  // window を持たない形 (旧レスポンスなど) は読めないので無いものとして扱う。
  assert.equal(findFiveHourRow([{ label: "5h limit", used: 6, limit: 100 }]), null);
  assert.equal(findFiveHourRow([]), null);
  assert.equal(findFiveHourRow(null), null);
});
