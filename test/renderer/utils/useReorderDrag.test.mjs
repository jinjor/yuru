import assert from "node:assert/strict";
import test from "node:test";

import {
  moveItem,
  resolveTargetIndex,
  toSlotSize,
} from "../../../src/renderer/utils/useReorderDrag.ts";

// 高さ 50px の項目が 10px 間隔で 4 つ並ぶ (スロットの大きさは 60px)。
function metrics(heights = [50, 50, 50, 50]) {
  let top = 0;
  return heights.map((height) => {
    const item = { top, height };
    top += height + 10;
    return item;
  });
}

test("toSlotSize は隣との隙間を含む縦幅を返す", () => {
  assert.equal(toSlotSize(metrics(), 0), 60);
  assert.equal(toSlotSize(metrics(), 1), 60);
  // 末尾の項目は 1 つ前との隙間から求める。
  assert.equal(toSlotSize(metrics(), 3), 60);
  assert.equal(toSlotSize(metrics([50, 30]), 1), 40);
});

test("resolveTargetIndex は動かさなければ元の位置を返す", () => {
  assert.equal(resolveTargetIndex(metrics(), 1, 60, 0), 1);
});

test("resolveTargetIndex は半スロット動かすたびに 1 つずつ入れ替わる", () => {
  const items = metrics();
  // 下へ 29px: 半スロット (30px) に届かないので元のまま。
  assert.equal(resolveTargetIndex(items, 0, 60, 29), 0);
  // 下へ 31px: 1 つ後ろへ。以降も半スロットではなく 1 スロットごとに 1 つずつ進む。
  assert.equal(resolveTargetIndex(items, 0, 60, 31), 1);
  assert.equal(resolveTargetIndex(items, 0, 60, 89), 1);
  assert.equal(resolveTargetIndex(items, 0, 60, 91), 2);
  // 上へ 31px: 1 つ前へ。
  assert.equal(resolveTargetIndex(items, 1, 60, -31), 0);
  assert.equal(resolveTargetIndex(items, 1, 60, -29), 1);
});

test("resolveTargetIndex は端まで動かすと端の index を返す", () => {
  const items = metrics();
  assert.equal(resolveTargetIndex(items, 0, 60, 180), 3);
  assert.equal(resolveTargetIndex(items, 3, 60, -180), 0);
});

test("resolveTargetIndex は高さがばらばらでも掴んだ項目のスロットを単位に入れ替わる", () => {
  // 高さ 50 / 20 / 80 の 3 つ。掴むのは先頭 (スロットの大きさは 60)。
  const items = metrics([50, 20, 80]);
  assert.equal(resolveTargetIndex(items, 0, 60, 14), 0);
  assert.equal(resolveTargetIndex(items, 0, 60, 16), 1);
  assert.equal(resolveTargetIndex(items, 0, 60, 74), 1);
  assert.equal(resolveTargetIndex(items, 0, 60, 76), 2);
});

test("moveItem は掴んだ項目を落ちる位置へ入れ直す", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
});
