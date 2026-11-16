import assert from "node:assert/strict";
import test from "node:test";

import { findExternalUrls, isExternalUrlProtocol } from "../../src/shared/external-url.ts";

test("isExternalUrlProtocol は外部で開けるスキームだけを許可する", () => {
  for (const protocol of ["http:", "https:", "chrome:"]) {
    assert.equal(isExternalUrlProtocol(protocol), true, protocol);
  }
  for (const protocol of ["file:", "javascript:", "ftp:", "data:", "mailto:"]) {
    assert.equal(isExternalUrlProtocol(protocol), false, protocol);
  }
});

test("findExternalUrls は http/https/chrome の URL を検出する", () => {
  assert.deepEqual(findExternalUrls("see https://example.com and chrome://settings/help"), [
    { url: "https://example.com", startIndex: 4 },
    { url: "chrome://settings/help", startIndex: 28 },
  ]);
});

test("findExternalUrls は対応しないスキームを拾わない", () => {
  assert.deepEqual(findExternalUrls("open file:///etc/hosts or ftp://example.com"), []);
});

test("findExternalUrls は Unicode の括弧・引用符で URL を区切る", () => {
  for (const [opening, closing] of [
    ["（", "）"],
    ["［", "］"],
    ["｛", "｝"],
    ["「", "」"],
    ["『", "』"],
    ["【", "】"],
    ["〈", "〉"],
    ["《", "》"],
    ["〔", "〕"],
    ["｢", "｣"],
    ["“", "”"],
    ["‘", "’"],
    ["«", "»"],
    ["‹", "›"],
  ]) {
    for (const suffix of ["", "後の文章"]) {
      const text = `${opening}https://example.com/docs${closing}${suffix}`;
      assert.deepEqual(
        findExternalUrls(text),
        [{ url: "https://example.com/docs", startIndex: opening.length }],
        text,
      );
    }
  }
});

test("findExternalUrls は和文の句読点と括弧の始まりでも URL を区切る", () => {
  for (const delimiter of ["、", "。", "，", "．", "；", "：", "！", "？", "（", "「"]) {
    const text = `https://example.com/docs${delimiter}続き`;
    assert.deepEqual(
      findExternalUrls(text),
      [{ url: "https://example.com/docs", startIndex: 0 }],
      text,
    );
  }
});

test("findExternalUrls は区切り文字を挟んで連続する URL を検出する", () => {
  assert.deepEqual(findExternalUrls("（https://example.com）「https://example.org/日本語」。"), [
    { url: "https://example.com", startIndex: 1 },
    { url: "https://example.org/日本語", startIndex: 22 },
  ]);
});

test("findExternalUrls は日本語 URL と対応した半角括弧を保持する", () => {
  for (const url of [
    "https://日本語.jp/資料?q=検索#結果",
    "https://example.com/wiki/Foo_(bar)",
    "https://[::1]/docs?q[]=value",
    "https://example.com/{name}",
    "https://example.com/a%EF%BC%89b",
    "https://example.com/a-b_c~d?q=a,b;c:d!e?f&x=1#fragment",
  ]) {
    assert.deepEqual(findExternalUrls(`（${url}）。`), [{ url, startIndex: 1 }], url);
  }
});

test("findExternalUrls は既存の半角の区切りと末尾記号を処理する", () => {
  for (const [opening, closing] of [
    ["(", ")."],
    ["[", "]"],
    ["{", "}"],
    ["<", ">"],
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
  ]) {
    assert.deepEqual(findExternalUrls(`${opening}https://example.com${closing}`), [
      { url: "https://example.com", startIndex: opening.length },
    ]);
  }
  assert.deepEqual(findExternalUrls("https://example.com.,;:!?"), [
    { url: "https://example.com", startIndex: 0 },
  ]);
});
