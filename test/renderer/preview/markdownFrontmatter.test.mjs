import assert from "node:assert/strict";
import test from "node:test";

import MarkdownIt from "markdown-it";
import { extendMarkdownItWithFrontmatter } from "../../../src/renderer/preview/markdownFrontmatter.ts";

function createMarkdownIt() {
  const md = new MarkdownIt({ html: false, linkify: true });
  extendMarkdownItWithFrontmatter(md);
  return md;
}

test("frontmatter を本文ではなくメタ情報の表として表示する", () => {
  const md = createMarkdownIt();
  const html = md.render(`---
title: Sample
tags:
  - one
  - two
config:
  nested: true
---

# Heading
`);

  assert.match(html, /<section class="md-frontmatter" aria-label="Frontmatter">/);
  assert.match(html, /<th scope="row">title<\/th><td>Sample<\/td>/);
  assert.match(html, /<th scope="row">tags<\/th><td><ul><li>one<\/li><li>two<\/li><\/ul><\/td>/);
  assert.match(html, /<th scope="row">config<\/th><td><code>nested: true<\/code><\/td>/);
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.doesNotMatch(html, /<hr>/);
  assert.doesNotMatch(html, /<h2>/);
});

test("frontmatter token は元の行範囲を持ち、変更クラスを描画する", () => {
  const md = createMarkdownIt();
  const env = {};
  const tokens = md.parse(
    `---
title: Sample
---

Body
`,
    env,
  );
  const frontmatter = tokens[0];

  assert.equal(frontmatter.type, "frontmatter");
  assert.deepEqual(frontmatter.map, [0, 3]);
  frontmatter.attrJoin("class", "md-changed");

  const html = md.renderer.render(tokens, md.options, env);
  assert.match(html, /class="md-frontmatter md-changed"/);
});

test("HTML に見える frontmatter の値をエスケープする", () => {
  const md = createMarkdownIt();
  const html = md.render(`---
title: "<img src=x onerror=alert(1)>"
---
`);

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
});

test("壊れた YAML は frontmatter の parse error として表示する", () => {
  const md = createMarkdownIt();
  const html = md.render(`---
title: [broken
---
`);

  assert.match(html, /class="md-frontmatter"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Failed to parse frontmatter/);
  assert.doesNotMatch(html, /<h2>/);
});

test("ファイル先頭で閉じられたブロックだけを frontmatter として扱う", () => {
  const md = createMarkdownIt();

  assert.doesNotMatch(md.render("Paragraph\n\n---\ntitle: Sample\n---\n"), /md-frontmatter/);
  assert.doesNotMatch(md.render("---\ntitle: Sample\n"), /md-frontmatter/);
});
