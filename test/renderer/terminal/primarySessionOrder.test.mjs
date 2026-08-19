import assert from "node:assert/strict";
import test from "node:test";

import { toPrimarySessionOrder } from "../../../src/renderer/terminal/primarySessionOrder.ts";

// 全体は A B C D E で、タブに出ているのは runtime を持つ A C E だけ。
const primarySessionKeys = ["A", "B", "C", "D", "E"];

test("toPrimarySessionOrder は左端に落としたタブを全体の先頭へ移す", () => {
  assert.deepEqual(toPrimarySessionOrder(primarySessionKeys, ["E", "A", "C"], "E"), [
    "E",
    "A",
    "B",
    "C",
    "D",
  ]);
});

test("toPrimarySessionOrder は落としたタブを左隣のタブの直後へ移す", () => {
  // A を C と E の間へ。B は動かず、前にいた A が抜けて先頭になるだけ。
  assert.deepEqual(toPrimarySessionOrder(primarySessionKeys, ["C", "A", "E"], "A"), [
    "B",
    "C",
    "A",
    "D",
    "E",
  ]);
});

test("toPrimarySessionOrder は右端に落としても最後のタブの直後まで", () => {
  // 末尾の D はタブに出ていないので、全体の末尾には届かない。
  assert.deepEqual(toPrimarySessionOrder(["A", "B", "C", "D"], ["B", "C", "A"], "A"), [
    "B",
    "C",
    "A",
    "D",
  ]);
});
