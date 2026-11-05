import assert from "node:assert/strict";
import test from "node:test";
import { getPreviewInfo, isBinaryContent } from "../../src/shared/preview.ts";

test("テキストとして扱うプレビューには SVG も含む", () => {
  for (const [file, kind] of [
    ["docs/README.md", "markdown"],
    ["README.MARKDOWN", "markdown"],
    ["index.html", "html"],
    ["docs/page.HTM", "html"],
    ["assets/logo.SVG", "image"],
  ]) {
    assert.deepEqual(getPreviewInfo(file), { kind, isBinary: false });
  }
});

test("画像・音声・動画・PDF の表示方式をファイル名の拡張子から選ぶ", () => {
  for (const [file, kind] of [
    ["assets/icon.png", "image"],
    ["assets/Photo.JPG", "image"],
    ["assets/theme.mp3", "audio"],
    ["assets/Intro.WAV", "audio"],
    ["docs/demo.mp4", "video"],
    ["docs/capture.mov", "video"],
    ["dir/日本語.PDF", "pdf"],
    ["/tmp/a.pdf", "pdf"],
  ]) {
    assert.deepEqual(getPreviewInfo(file), { kind, isBinary: true });
  }
});

test("未知の形式・拡張子なし・dotfile はテキストの表示先に渡す", () => {
  for (const file of [
    "src/index.ts",
    "unknown.bin",
    "Makefile",
    "some.dir/README",
    "dir.pdf/file",
    ".png",
    ".mp3",
    ".pdf",
    ".md",
    "dir/.html",
    "md",
    "document.pdf.html.bak",
    "file.constructor",
    "file.__proto__",
    "dir/",
  ]) {
    assert.deepEqual(getPreviewInfo(file), { kind: null, isBinary: false });
  }
});

test("中身のバイナリ判定は拡張子と独立に NUL バイトで行う", () => {
  assert.equal(isBinaryContent(new TextEncoder().encode("日本語のテキスト\n")), false);
  assert.equal(isBinaryContent(new Uint8Array()), false);
  assert.equal(isBinaryContent(new Uint8Array([48])), false); // 文字の 0
  assert.equal(isBinaryContent(new Uint8Array([65, 0, 66])), true);
});
