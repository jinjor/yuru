import assert from "node:assert/strict";
import test from "node:test";

import { computeLineChanges } from "../../../../src/renderer/preview/editor/lineChanges.ts";

test("変更が無ければマークも行数も空", () => {
  const { marks, stat } = computeLineChanges(["a", "b", "c"], ["a", "b", "c"]);
  assert.deepEqual(marks, []);
  assert.deepEqual(stat, { added: 0, deleted: 0 });
});

test("純粋な追加は追加行に added マークが付く", () => {
  const { marks, stat } = computeLineChanges(["a", "b"], ["a", "x", "y", "b"]);
  assert.deepEqual(marks, [
    { line: 2, kind: "added" },
    { line: 3, kind: "added" },
  ]);
  assert.deepEqual(stat, { added: 2, deleted: 0 });
});

test("先頭への追加は 1 行目に added マークが付く", () => {
  const { marks, stat } = computeLineChanges(["b"], ["a", "b"]);
  assert.deepEqual(marks, [{ line: 1, kind: "added" }]);
  assert.deepEqual(stat, { added: 1, deleted: 0 });
});

test("中間の純粋な削除は削除境界 (削除後の行) に deleted マークが付く", () => {
  const { marks, stat } = computeLineChanges(["a", "b", "c"], ["a", "c"]);
  assert.deepEqual(marks, [{ line: 2, kind: "deleted" }]);
  assert.deepEqual(stat, { added: 0, deleted: 1 });
});

test("先頭の純粋な削除は 1 行目に deleted マークが付く", () => {
  const { marks, stat } = computeLineChanges(["a", "b"], ["b"]);
  assert.deepEqual(marks, [{ line: 1, kind: "deleted" }]);
  assert.deepEqual(stat, { added: 0, deleted: 1 });
});

test("末尾の削除は最終行に deleted-end マークが付く", () => {
  const { marks, stat } = computeLineChanges(["a", "b", "c"], ["a", "b"]);
  assert.deepEqual(marks, [{ line: 2, kind: "deleted-end" }]);
  assert.deepEqual(stat, { added: 0, deleted: 1 });
});

test("行の変更 (削除+追加が隣接) は緑のみで赤マークは出さず、行数は両方数える", () => {
  const { marks, stat } = computeLineChanges(["a", "b", "c"], ["a", "B", "c"]);
  assert.deepEqual(marks, [{ line: 2, kind: "added" }]);
  assert.deepEqual(stat, { added: 1, deleted: 1 });
});

test("追加・削除・変更が混在しても現在行番号に整合する", () => {
  // original: a b c d e
  // current : a X c d   (b->X 変更, e 削除)
  const { marks, stat } = computeLineChanges(["a", "b", "c", "d", "e"], ["a", "X", "c", "d"]);
  assert.deepEqual(marks, [
    { line: 2, kind: "added" },
    { line: 4, kind: "deleted-end" },
  ]);
  assert.deepEqual(stat, { added: 1, deleted: 2 });
});
