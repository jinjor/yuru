import assert from "node:assert/strict";
import test from "node:test";

import { setFileDownloadDrag } from "../../../src/renderer/utils/fileDrag.ts";

function fakeDataTransfer() {
  const data = new Map();
  return {
    data,
    setData: (type, value) => data.set(type, value),
  };
}

test("setFileDownloadDrag はファイルの file:// URL を DownloadURL に入れる", () => {
  const dataTransfer = fakeDataTransfer();
  setFileDownloadDrag(dataTransfer, "/Users/me/repo/docs/guide.md", "guide.md");
  assert.equal(
    dataTransfer.data.get("DownloadURL"),
    "application/octet-stream:guide.md:file:///Users/me/repo/docs/guide.md",
  );
});

test("setFileDownloadDrag は URL として特別な意味を持つ文字と非 ASCII をパーセントエンコードする", () => {
  const dataTransfer = fakeDataTransfer();
  setFileDownloadDrag(dataTransfer, "/repo/my dir/50% #1?.md", "50% #1?.md");
  assert.equal(
    dataTransfer.data.get("DownloadURL"),
    "application/octet-stream:50% #1?.md:file:///repo/my%20dir/50%25%20%231%3F.md",
  );

  setFileDownloadDrag(dataTransfer, "/repo/資料.md", "資料.md");
  assert.equal(
    dataTransfer.data.get("DownloadURL"),
    "application/octet-stream:資料.md:file:///repo/%E8%B3%87%E6%96%99.md",
  );
});

test("setFileDownloadDrag は名前に : を含むファイルを外へ出さない", () => {
  const dataTransfer = fakeDataTransfer();
  setFileDownloadDrag(dataTransfer, "/repo/a:b.md", "a:b.md");
  assert.equal(dataTransfer.data.has("DownloadURL"), false);
});
