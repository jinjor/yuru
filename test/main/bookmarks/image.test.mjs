import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-bookmark-image-"));
process.env.YURU_HOME = path.join(testRoot, "yuru-home");

const { bookmarkImagePath, deleteBookmarkImage, saveBookmarkImage } = await import(
  "../../../src/main/bookmarks/image.ts"
);

// 1x1 の PNG。中身は問わないので短いバイト列を base64 にして使う。
const pngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

test("saveBookmarkImage は画像を保存して file:// URL を返す", () => {
  const url = saveBookmarkImage(`data:image/png;base64,${pngBase64}`);
  const filePath = fileURLToPath(url);

  assert.equal(path.extname(filePath), ".png");
  assert.equal(path.dirname(filePath), path.join(process.env.YURU_HOME, "bookmark-images"));
  assert.deepEqual(fs.readFileSync(filePath), Buffer.from(pngBase64, "base64"));
});

test("saveBookmarkImage は貼るたびに別ファイルにする", () => {
  const first = saveBookmarkImage(`data:image/png;base64,${pngBase64}`);
  const second = saveBookmarkImage(`data:image/png;base64,${pngBase64}`);
  assert.notEqual(first, second);
});

test("saveBookmarkImage は media type から拡張子を決める", () => {
  const url = saveBookmarkImage(`data:image/jpeg;base64,${pngBase64}`);
  assert.equal(path.extname(fileURLToPath(url)), ".jpg");
});

test("saveBookmarkImage は対応していない形式を保存しない", () => {
  assert.equal(saveBookmarkImage(`data:image/svg+xml;base64,${pngBase64}`), null);
  assert.equal(saveBookmarkImage(`data:text/plain;base64,${pngBase64}`), null);
  assert.equal(saveBookmarkImage("https://example.com/a.png"), null);
  // base64 以外の data URL も受けない
  assert.equal(saveBookmarkImage("data:image/png,abc"), null);
});

test("bookmarkImagePath は保存場所の外を指す URL を扱わない", () => {
  const url = saveBookmarkImage(`data:image/png;base64,${pngBase64}`);
  assert.equal(bookmarkImagePath(url), fileURLToPath(url));

  assert.equal(bookmarkImagePath("https://example.com/a.png"), null);
  assert.equal(bookmarkImagePath(`file://${path.join(testRoot, "elsewhere.png")}`), null);
  assert.equal(bookmarkImagePath("not a url"), null);
});

test("deleteBookmarkImage は実体を消し、無くても失敗しない", () => {
  const url = saveBookmarkImage(`data:image/png;base64,${pngBase64}`);
  deleteBookmarkImage(url);
  assert.equal(fs.existsSync(fileURLToPath(url)), false);

  deleteBookmarkImage(url);
  deleteBookmarkImage("https://example.com/a.png");
});
