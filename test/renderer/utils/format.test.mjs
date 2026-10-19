import assert from "node:assert/strict";
import test from "node:test";

import { formatRelativeTime } from "../../../src/renderer/utils/format.ts";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const now = Date.UTC(2026, 9, 19);

test("formatRelativeTime は 1 以上になる最も大きい単位で表す", () => {
  assert.equal(formatRelativeTime(now - 30 * 1000, now), "now");
  assert.equal(formatRelativeTime(now - 5 * MINUTE_MS, now), "5 minutes ago");
  assert.equal(formatRelativeTime(now - DAY_MS, now), "yesterday");
  assert.equal(formatRelativeTime(now - 3 * DAY_MS - MINUTE_MS, now), "3 days ago");
  assert.equal(formatRelativeTime(now - 400 * DAY_MS, now), "last year");
});

test("formatRelativeTime は未来の時刻を now にする", () => {
  assert.equal(formatRelativeTime(now + DAY_MS, now), "now");
});
