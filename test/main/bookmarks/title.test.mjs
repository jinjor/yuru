import assert from "node:assert/strict";
import test from "node:test";

import { extractGitHubIssueOrPr, parseHtmlTitle } from "../../../src/main/bookmarks/title.ts";

test("extractGitHubIssueOrPr は issue / pull の URL から owner/repo/番号を取り出す", () => {
  assert.deepEqual(extractGitHubIssueOrPr("https://github.com/jinjor/yuru/issues/71"), {
    owner: "jinjor",
    repo: "yuru",
    number: "71",
  });
  assert.deepEqual(extractGitHubIssueOrPr("https://github.com/jinjor/yuru/pull/72"), {
    owner: "jinjor",
    repo: "yuru",
    number: "72",
  });
  // issue / pull 番号より後に path segment が続く URL は対象外
  assert.deepEqual(
    extractGitHubIssueOrPr("https://github.com/jinjor/yuru/pull/72/files?diff=split#r1"),
    null,
  );
  // 末尾スラッシュ・クエリ・フラグメントは許容する
  assert.deepEqual(extractGitHubIssueOrPr("https://github.com/jinjor/yuru/issues/71/"), {
    owner: "jinjor",
    repo: "yuru",
    number: "71",
  });
  assert.deepEqual(extractGitHubIssueOrPr("https://github.com/jinjor/yuru/issues/71?x=1#y"), {
    owner: "jinjor",
    repo: "yuru",
    number: "71",
  });
});

test("extractGitHubIssueOrPr は issue / pull 以外や GitHub 以外の URL を弾く", () => {
  assert.equal(extractGitHubIssueOrPr("https://github.com/jinjor/yuru"), null);
  assert.equal(extractGitHubIssueOrPr("https://github.com/jinjor/yuru/discussions/3"), null);
  assert.equal(extractGitHubIssueOrPr("https://github.com/jinjor/yuru/blob/main/README.md"), null);
  assert.equal(extractGitHubIssueOrPr("https://example.com/jinjor/yuru/issues/71"), null);
  assert.equal(extractGitHubIssueOrPr("https://github.com/jinjor/yuru/issues/abc"), null);
  assert.equal(extractGitHubIssueOrPr("not a url"), null);
});

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
