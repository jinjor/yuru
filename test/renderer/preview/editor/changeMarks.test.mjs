import assert from "node:assert/strict";
import test from "node:test";

import { toChangeMarks } from "../../../../src/renderer/preview/editor/changeMarks.ts";

test("hunk が無ければマークも無い", () => {
  assert.deepEqual(toChangeMarks([]), []);
});

test("追加の hunk は追加行ごとに added マークが付く", () => {
  const marks = toChangeMarks([{ line: 2, addedCount: 2, removedCount: 0, atEnd: false }]);
  assert.deepEqual(marks, [
    { line: 2, kind: "added" },
    { line: 3, kind: "added" },
  ]);
});

test("削除だけの hunk は削除跡の行に deleted マークが付く", () => {
  const marks = toChangeMarks([{ line: 2, addedCount: 0, removedCount: 1, atEnd: false }]);
  assert.deepEqual(marks, [{ line: 2, kind: "deleted" }]);
});

test("末尾の削除は deleted-end マークが付く", () => {
  const marks = toChangeMarks([{ line: 2, addedCount: 0, removedCount: 1, atEnd: true }]);
  assert.deepEqual(marks, [{ line: 2, kind: "deleted-end" }]);
});

test("追加と削除を持つ hunk (行の書き換え) は緑のみで赤マークは出さない", () => {
  const marks = toChangeMarks([{ line: 2, addedCount: 1, removedCount: 1, atEnd: false }]);
  assert.deepEqual(marks, [{ line: 2, kind: "added" }]);
});
