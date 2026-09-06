import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdown } from "../../../src/renderer/preview/markdownRender.ts";

const removedMarker = '<div class="md-removed" aria-label="lines removed"></div>';

test("変更が無ければ印は付かない", () => {
  const html = renderMarkdown("para\n", new Set(), []);
  assert.equal(html, "<p>para</p>\n");
});

test("追加された行を含むブロックに緑の印が付く", () => {
  // 1: first
  // 2:
  // 3: second (追加)
  const html = renderMarkdown("first\n\nsecond\n", new Set([3]), []);
  assert.equal(html, '<p>first</p>\n<p class="md-changed">second</p>\n');
});

test("ブロックの間の削除は直後のブロックの前にマーカーを置く", () => {
  const html = renderMarkdown("first\n\nsecond\n", new Set(), [{ line: 3, atEnd: false }]);
  assert.equal(html, `<p>first</p>\n${removedMarker}<p>second</p>\n`);
});

test("ブロックの途中の削除はそのブロック自体に赤い印を付ける", () => {
  // リストの 2 つ目の項目が消えた場合。マーカーを ul の中に割り込ませずに印を付ける。
  const html = renderMarkdown("- a\n- b\n- c\n", new Set(), [{ line: 2, atEnd: false }]);
  assert.match(html, /^<ul class="md-removed-inside">/);
  assert.ok(!html.includes(removedMarker));
});

test("同じブロックで追加と削除が混ざると緑と赤の両方が付く", () => {
  // リストの中で 1 項目が書き換わり、別の項目が消えた場合。
  const html = renderMarkdown("- a\n- B\n- c\n", new Set([2]), [{ line: 3, atEnd: false }]);
  assert.match(html, /^<ul class="md-removed-inside md-changed">/);
});

test("文末の削除は最後にマーカーを置く", () => {
  const html = renderMarkdown("first\n", new Set(), [{ line: 1, atEnd: true }]);
  assert.equal(html, `<p>first</p>\n${removedMarker}`);
});
