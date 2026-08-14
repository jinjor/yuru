import assert from "node:assert/strict";
import test from "node:test";

import {
  isCursorPositionQuery,
  isCursorPositionReport,
} from "../../../src/main/terminal/cursor-position.ts";

test("標準・private cursor position query を識別する", () => {
  assert.equal(isCursorPositionQuery("\x1b[6n"), true);
  assert.equal(isCursorPositionQuery("\x1b[?6n"), true);
  assert.equal(isCursorPositionQuery("\x1b[?6n\x1b[?6n"), true);
});

test("xterm が返す標準・private cursor position report を識別する", () => {
  assert.equal(isCursorPositionReport("\x1b[24;80R"), true);
  assert.equal(isCursorPositionReport("\x1b[?55;3R"), true);
});

test("キー入力・マウス入力・通常出力は cursor position protocol にしない", () => {
  assert.equal(isCursorPositionQuery("n"), false);
  assert.equal(isCursorPositionQuery("\x1b[?6nredraw"), false);
  assert.equal(isCursorPositionReport("R"), false);
  assert.equal(isCursorPositionReport("\x1b[A"), false);
  assert.equal(isCursorPositionReport("\x1b[<0;52;29M"), false);
});
