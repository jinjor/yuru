import assert from "node:assert/strict";
import test from "node:test";

import { computeDiffHunks } from "../../../src/renderer/preview/diffHunks.ts";

test("変更が無ければ hunk も行数も空", () => {
  const { hunks, stat } = computeDiffHunks(["a", "b", "c"], ["a", "b", "c"]);
  assert.deepEqual(hunks, []);
  assert.deepEqual(stat, { added: 0, deleted: 0 });
});

test("純粋な追加は追加行の先頭を指す hunk になる", () => {
  const { hunks, stat } = computeDiffHunks(["a", "b"], ["a", "x", "y", "b"]);
  assert.deepEqual(hunks, [{ line: 2, addedCount: 2, removedCount: 0, atEnd: false }]);
  assert.deepEqual(stat, { added: 2, deleted: 0 });
});

test("先頭への追加は 1 行目を指す", () => {
  const { hunks, stat } = computeDiffHunks(["b"], ["a", "b"]);
  assert.deepEqual(hunks, [{ line: 1, addedCount: 1, removedCount: 0, atEnd: false }]);
  assert.deepEqual(stat, { added: 1, deleted: 0 });
});

test("中間の純粋な削除は削除境界 (削除後の行) を指す", () => {
  const { hunks, stat } = computeDiffHunks(["a", "b", "c"], ["a", "c"]);
  assert.deepEqual(hunks, [{ line: 2, addedCount: 0, removedCount: 1, atEnd: false }]);
  assert.deepEqual(stat, { added: 0, deleted: 1 });
});

test("先頭の純粋な削除は 1 行目を指す", () => {
  const { hunks, stat } = computeDiffHunks(["a", "b"], ["b"]);
  assert.deepEqual(hunks, [{ line: 1, addedCount: 0, removedCount: 1, atEnd: false }]);
  assert.deepEqual(stat, { added: 0, deleted: 1 });
});

test("末尾の削除は最終行を指す atEnd の hunk になる", () => {
  const { hunks, stat } = computeDiffHunks(["a", "b", "c"], ["a", "b"]);
  assert.deepEqual(hunks, [{ line: 2, addedCount: 0, removedCount: 1, atEnd: true }]);
  assert.deepEqual(stat, { added: 0, deleted: 1 });
});

test("行の書き換えは追加と削除を持つ 1 つの hunk になる", () => {
  const { hunks, stat } = computeDiffHunks(["a", "b", "c"], ["a", "B", "c"]);
  assert.deepEqual(hunks, [{ line: 2, addedCount: 1, removedCount: 1, atEnd: false }]);
  assert.deepEqual(stat, { added: 1, deleted: 1 });
});

test("追加・削除・書き換えが混在しても現在行番号に整合する", () => {
  // original: a b c d e
  // current : a X c d   (b->X 書き換え, e 削除)
  const { hunks, stat } = computeDiffHunks(["a", "b", "c", "d", "e"], ["a", "X", "c", "d"]);
  assert.deepEqual(hunks, [
    { line: 2, addedCount: 1, removedCount: 1, atEnd: false },
    { line: 4, addedCount: 0, removedCount: 1, atEnd: true },
  ]);
  assert.deepEqual(stat, { added: 1, deleted: 2 });
});
