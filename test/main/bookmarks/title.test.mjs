import assert from "node:assert/strict";
import test from "node:test";

import { parseHtmlTitle } from "../../../src/main/bookmarks/title.ts";

test("parseHtmlTitle は title タグの中身を entity 展開して返す", () => {
  assert.equal(
    parseHtmlTitle(
      "<html><head><title>GraphQL: Field &#39;isInMergeQueue&#39; · Issue</title></head></html>",
    ),
    "GraphQL: Field 'isInMergeQueue' · Issue",
  );
  assert.equal(parseHtmlTitle("<title>a &amp; b &lt;tag&gt;</title>"), "a & b <tag>");
  assert.equal(parseHtmlTitle("<TITLE>Upper</TITLE>"), "Upper");
  assert.equal(parseHtmlTitle("<title>  padded  </title>"), "padded");
});

test("parseHtmlTitle は title がない・空なら null", () => {
  assert.equal(parseHtmlTitle("<html><head></head></html>"), null);
  assert.equal(parseHtmlTitle("<title>   </title>"), null);
});
