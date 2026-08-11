import assert from "node:assert/strict";
import test from "node:test";

import { parseKimiResetHint } from "../../../../src/main/agents/kimi/plan-usage.ts";

const fetchedAt = Date.parse("2026-08-09T10:00:00.000Z");

test("kimi の残り時間表記を絶対時刻に直す", () => {
  assert.equal(
    parseKimiResetHint("resets in 6d 5h 28m", fetchedAt),
    fetchedAt + ((6 * 24 + 5) * 3600 + 28 * 60) * 1000,
  );
  assert.equal(parseKimiResetHint("resets in 2h 28m", fetchedAt), fetchedAt + (2 * 3600 + 28 * 60) * 1000);
  assert.equal(parseKimiResetHint("resets in 12m", fetchedAt), fetchedAt + 12 * 60 * 1000);
  // 秒は他の単位が 0 のときだけ出る。
  assert.equal(parseKimiResetHint("resets in 30s", fetchedAt), fetchedAt + 30 * 1000);
});

test("リセット済み・解釈できない表記は時刻を作らない", () => {
  // 既にリセットされている。
  assert.equal(parseKimiResetHint("reset", fetchedAt), null);
  // upstream の時刻を kimi 側が解釈できなかったときの形。
  assert.equal(parseKimiResetHint("resets at 2026-08-14T20:00:00+09:00", fetchedAt), null);
  assert.equal(parseKimiResetHint("", fetchedAt), null);
  assert.equal(parseKimiResetHint("resets in soon", fetchedAt), null);
});
