import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { previewFileUrl } from "../../../src/renderer/preview/fileUrl.ts";

test("特殊文字を含む実パスを file URL に変換する", () => {
  for (const [absolutePath, windows] of [
    ["/tmp/日本語 #?%\\.png", false],
    ["C:\\Users\\a b\\日本語 #?%.png", true],
    ["\\\\server\\share\\a b#?%.png", true],
  ]) {
    const expected = pathToFileURL(absolutePath, { windows });
    expected.searchParams.set("v", "123:456");
    assert.equal(
      previewFileUrl({ absolutePath, byteLength: 123, contentId: "123:456" }),
      expected.href,
    );
  }
});

test("同じパスでも版が変わると URL が変わる", () => {
  const source = { absolutePath: "/tmp/audio.wav", byteLength: 123, contentId: "123:456" };
  const before = previewFileUrl(source);
  const after = previewFileUrl({ ...source, contentId: "123:789" });
  assert.notEqual(before, after);
  assert.equal(new URL(before).pathname, new URL(after).pathname);
});
