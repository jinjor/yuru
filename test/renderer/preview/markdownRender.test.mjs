import assert from "node:assert/strict";
import test from "node:test";

import { getHighlighter } from "../../../src/renderer/preview/highlight.ts";
import { renderMarkdown } from "../../../src/renderer/preview/markdownRender.ts";

const removedMarker = '<div class="md-removed" aria-label="lines removed"></div>';

function added(line, count) {
  return { line, addedCount: count, removedCount: 0, atEnd: false };
}

function removed(line) {
  return { line, addedCount: 0, removedCount: 1, atEnd: false };
}

test("変更が無ければ印は付かない", () => {
  const html = renderMarkdown("para\n", []);
  assert.equal(html, "<p>para</p>\n");
});

test("追加された行を含むブロックに緑の印が付く", () => {
  // 1: first
  // 2:
  // 3: second (追加)
  const html = renderMarkdown("first\n\nsecond\n", [added(3, 1)]);
  assert.equal(html, '<p>first</p>\n<p class="md-changed">second</p>\n');
});

test("複数行の追加は掛かっているブロックすべてに印が付く", () => {
  const html = renderMarkdown("first\n\nsecond\n", [added(1, 3)]);
  assert.equal(html, '<p class="md-changed">first</p>\n<p class="md-changed">second</p>\n');
});

test("ブロックの間の削除は直後のブロックの前にマーカーを置く", () => {
  const html = renderMarkdown("first\n\nsecond\n", [removed(3)]);
  assert.equal(html, `<p>first</p>\n${removedMarker}<p>second</p>\n`);
});

test("ブロックの途中の削除はそのブロック自体に赤い印を付ける", () => {
  // リストの 2 つ目の項目が消えた場合。マーカーを ul の中に割り込ませずに印を付ける。
  const html = renderMarkdown("- a\n- b\n- c\n", [removed(2)]);
  assert.match(html, /^<ul class="md-removed-inside">/);
  assert.ok(!html.includes(removedMarker));
});

test("同じブロックで追加と削除が混ざると緑と赤の両方が付く", () => {
  // リストの中で 1 項目が書き換わり、別の項目が消えた場合。
  const html = renderMarkdown("- a\n- B\n- c\n", [
    { line: 2, addedCount: 1, removedCount: 1, atEnd: false },
    removed(3),
  ]);
  assert.match(html, /^<ul class="md-removed-inside md-changed">/);
});

test("文末の削除は最後にマーカーを置く", () => {
  const html = renderMarkdown("first\n", [{ line: 1, addedCount: 0, removedCount: 1, atEnd: true }]);
  assert.equal(html, `<p>first</p>\n${removedMarker}`);
});

test("highlighter を渡すとコードフェンスに色が付く", async () => {
  const highlighter = await getHighlighter();
  const html = renderMarkdown("```ts\nconst a = 1;\n```\n", [], highlighter);
  assert.match(html, /^<pre><code class="language-ts"><span style="color:#[0-9A-Fa-f]{6}">const<\/span>/);
  // 色を付けても中身のテキストは変わらない。
  assert.equal(stripTags(html), stripTags(renderMarkdown("```ts\nconst a = 1;\n```\n", [])));
});

test("diff のコードフェンスは追加行と削除行が別の色になる", async () => {
  const highlighter = await getHighlighter();
  const html = renderMarkdown("```diff\n-old\n+new\n```\n", [], highlighter);
  const colors = [...html.matchAll(/color:(#[0-9A-Fa-f]{6})/g)].map((match) => match[1]);
  assert.equal(colors.length, 2);
  assert.notEqual(colors[0], colors[1]);
});

test("対応していない言語と言語指定なしのフェンスはそのまま出す", async () => {
  const highlighter = await getHighlighter();
  assert.equal(
    renderMarkdown("```brainfuck\n+[-]\n```\n", [], highlighter),
    '<pre><code class="language-brainfuck">+[-]\n</code></pre>\n',
  );
  assert.equal(
    renderMarkdown("```\na < b\n```\n", [], highlighter),
    "<pre><code>a &lt; b\n</code></pre>\n",
  );
});

test("ハイライトしてもコードフェンスの変更マークは残る", async () => {
  const highlighter = await getHighlighter();
  const html = renderMarkdown("```ts\nconst a = 1;\n```\n", [added(1, 3)], highlighter);
  assert.match(html, /^<pre><code class="md-changed language-ts">/);
});

function stripTags(html) {
  return html.replace(/<[^>]*>/g, "");
}
