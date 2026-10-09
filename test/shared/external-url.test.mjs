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
