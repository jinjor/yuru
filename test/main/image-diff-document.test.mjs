import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getImageDiffDocument, getImageFileDocument } from "../../src/main/image-diff.ts";
import { imageMediaType } from "../../src/shared/image-preview.ts";

// 1x1 の PNG を 2 枚 (中身が違うので diff の両側になる)
const redPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const bluePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhQGAWpKrPAAAAABJRU5ErkJggg==",
  "base64",
);

function cleanGitEnv(env) {
  const next = { ...env };
  delete next.GIT_DIR;
  delete next.GIT_WORK_TREE;
  return next;
}

function git(args, cwd) {
  execFileSync("git", args, { cwd, env: cleanGitEnv(process.env), stdio: "ignore" });
}

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-image-"));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  git(["init"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  return dir;
}

function commitAll(dir, message) {
  git(["add", "."], dir);
  git(["-c", "commit.gpgsign=false", "commit", "-m", message], dir);
}

function dataUrlFor(buffer, mediaType) {
  return `data:${mediaType};base64,${buffer.toString("base64")}`;
}

test("imageMediaType は拡張子から画像形式を判定する", () => {
  assert.equal(imageMediaType("assets/icon.png"), "image/png");
  assert.equal(imageMediaType("assets/Photo.JPG"), "image/jpeg");
  assert.equal(imageMediaType("assets/logo.svg"), "image/svg+xml");
  assert.equal(imageMediaType("src/index.ts"), null);
  // 拡張子のないファイル、ディレクトリ名だけに "." があるパス、dotfile は画像ではない
  assert.equal(imageMediaType("Makefile"), null);
  assert.equal(imageMediaType("some.dir/README"), null);
  assert.equal(imageMediaType(".png"), null);
});

test("getImageDiffDocument は画像でない path に null を返す", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "a.txt"), "text\n");
  commitAll(dir, "init");

  assert.equal(await getImageDiffDocument(dir, "a.txt"), null);
});

test("getImageDiffDocument は変更した画像の元と現在を data URL で返す", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "icon.png"), redPng);
  commitAll(dir, "init");
  fs.writeFileSync(path.join(dir, "icon.png"), bluePng);

  const document = await getImageDiffDocument(dir, "icon.png");
  assert.equal(document.path, "icon.png");
  assert.equal(document.original.dataUrl, dataUrlFor(redPng, "image/png"));
  assert.equal(document.original.byteLength, redPng.byteLength);
  assert.equal(document.current.dataUrl, dataUrlFor(bluePng, "image/png"));
  assert.equal(document.current.byteLength, bluePng.byteLength);
});

test("getImageDiffDocument は変更のない画像で両側に同じ data URL を返す", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "icon.png"), redPng);
  commitAll(dir, "init");

  const document = await getImageDiffDocument(dir, "icon.png");
  assert.equal(document.original.dataUrl, document.current.dataUrl);
});

test("getImageDiffDocument は追加を original なし、削除を current なしで表す", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "kept.png"), redPng);
  fs.writeFileSync(path.join(dir, "removed.png"), redPng);
  commitAll(dir, "init");
  fs.writeFileSync(path.join(dir, "added.png"), bluePng);
  fs.rmSync(path.join(dir, "removed.png"));

  const added = await getImageDiffDocument(dir, "added.png");
  assert.equal(added.original, null);
  assert.equal(added.current.dataUrl, dataUrlFor(bluePng, "image/png"));

  const removed = await getImageDiffDocument(dir, "removed.png");
  assert.equal(removed.original.dataUrl, dataUrlFor(redPng, "image/png"));
  assert.equal(removed.current, null);
});

test("getImageDiffDocument の staged は index の内容、unstaged は作業ツリーの内容を現在側にする", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "icon.png"), redPng);
  commitAll(dir, "init");
  // index に blue を stage し、その後 worktree を red に戻す (index と worktree がずれた状態)
  fs.writeFileSync(path.join(dir, "icon.png"), bluePng);
  git(["add", "icon.png"], dir);
  fs.writeFileSync(path.join(dir, "icon.png"), redPng);

  const staged = await getImageDiffDocument(dir, "icon.png", "staged");
  assert.equal(staged.original.dataUrl, dataUrlFor(redPng, "image/png"));
  assert.equal(staged.current.dataUrl, dataUrlFor(bluePng, "image/png"));

  const unstaged = await getImageDiffDocument(dir, "icon.png", "unstaged");
  assert.equal(unstaged.original.dataUrl, dataUrlFor(bluePng, "image/png"));
  assert.equal(unstaged.current.dataUrl, dataUrlFor(redPng, "image/png"));
});

test("getImageFileDocument は worktree 外の画像を差分なしで返す", async (t) => {
  const dir = makeRepo(t);
  const outside = path.join(dir, "outside.png");
  fs.writeFileSync(outside, redPng);

  const document = await getImageFileDocument(outside);
  assert.equal(document.path, outside);
  assert.equal(document.original.dataUrl, dataUrlFor(redPng, "image/png"));
  assert.equal(document.current.dataUrl, document.original.dataUrl);

  assert.equal(await getImageFileDocument(path.join(dir, "missing.png")), null);
  assert.equal(await getImageFileDocument(dir), null);
});
