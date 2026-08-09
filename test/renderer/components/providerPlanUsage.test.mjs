import assert from "node:assert/strict";
import test from "node:test";

import { formatRemaining } from "../../../src/renderer/components/planUsageRemaining.ts";

test("残り時間は上位 2 単位までにする", () => {
  assert.equal(formatRemaining((6 * 24 + 5) * 3600_000 + 28 * 60_000), "6d5h");
  assert.equal(formatRemaining(2 * 3600_000 + 9 * 60_000), "2h9m");
  assert.equal(formatRemaining(12 * 60_000), "12m");
});

test("1 分未満と経過済みは <1m にする", () => {
  assert.equal(formatRemaining(59_000), "<1m");
  assert.equal(formatRemaining(0), "<1m");
  // リセット時刻を過ぎたまま次の取得が来ていない間。
  assert.equal(formatRemaining(-60_000), "<1m");
});
