import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getPreviewDiffDocument,
  getPreviewFileDocument,
} from "../../../src/main/preview/binary-preview.ts";

// 16bit PCM モノラルの WAV (RIFF/WAVE の仕様どおりのヘッダ + サンプル)
function makeWav(sampleCount, value) {
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // fmt チャンクの長さ
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // モノラル
  buffer.writeUInt32LE(8000, 24); // サンプリングレート
  buffer.writeUInt32LE(8000 * 2, 28); // バイト毎秒
  buffer.writeUInt16LE(2, 32); // ブロックサイズ
  buffer.writeUInt16LE(16, 34); // ビット深度
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < sampleCount; i++) {
    buffer.writeInt16LE(value, 44 + i * 2);
  }
  return buffer;
}

const quietWav = makeWav(64, 1000);
const loudWav = makeWav(96, 12000);

function sourcePath(side) {
  return side.absolutePath;
}

function readSide(side) {
  return fs.readFileSync(sourcePath(side));
}

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-preview-"));
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

test("作業ツリーのファイルはコピーせず、そのまま指す", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "theme.wav"), quietWav);
  commitAll(dir, "init");
  fs.writeFileSync(path.join(dir, "theme.wav"), loudWav);

  const document = await getPreviewDiffDocument(dir, "theme.wav");
  assert.equal(document.path, "theme.wav");
  assert.equal(sourcePath(document.current), path.join(dir, "theme.wav"));
  assert.equal(document.current.byteLength, loudWav.byteLength);
  assert.equal(document.original.byteLength, quietWav.byteLength);
});

test("git の中にしかない側は取り出してから指す", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "theme.wav"), quietWav);
  commitAll(dir, "init");
  fs.writeFileSync(path.join(dir, "theme.wav"), loudWav);

  const document = await getPreviewDiffDocument(dir, "theme.wav");
  assert.notEqual(sourcePath(document.original), path.join(dir, "theme.wav"));
  assert.deepEqual(readSide(document.original), quietWav);
  // 拡張子は残す (Chromium が形式を判断する手がかり)
  assert.equal(path.extname(sourcePath(document.original)), ".wav");
  // blob OID は不変なので、2 回目も同じ場所・同じ識別子になる
  const again = await getPreviewDiffDocument(dir, "theme.wav");
  assert.equal(again.original.contentId, document.original.contentId);
});

test("中身が変わると版の識別子も変わる", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "theme.wav"), quietWav);
  commitAll(dir, "init");

  const before = await getPreviewDiffDocument(dir, "theme.wav");
  assert.equal(before.original.contentId, before.current.contentId);

  fs.writeFileSync(path.join(dir, "theme.wav"), loudWav);
  const after = await getPreviewDiffDocument(dir, "theme.wav");
  assert.equal(sourcePath(after.current), sourcePath(before.current));
  assert.notEqual(after.current.contentId, before.current.contentId);
});

test("追加は original なし、削除は current なしで表す", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "kept.wav"), quietWav);
  fs.writeFileSync(path.join(dir, "removed.wav"), quietWav);
  commitAll(dir, "init");
  fs.writeFileSync(path.join(dir, "added.wav"), loudWav);
  fs.rmSync(path.join(dir, "removed.wav"));

  const added = await getPreviewDiffDocument(dir, "added.wav");
  assert.equal(added.original, null);
  assert.equal(added.current.byteLength, loudWav.byteLength);

  const removed = await getPreviewDiffDocument(dir, "removed.wav");
  assert.deepEqual(readSide(removed.original), quietWav);
  assert.equal(removed.current, null);
});

test("staged は index の内容、unstaged は作業ツリーの内容を現在側にする", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "theme.wav"), quietWav);
  commitAll(dir, "init");
  // index に loud を stage し、その後 worktree を quiet に戻す (index と worktree がずれた状態)
  fs.writeFileSync(path.join(dir, "theme.wav"), loudWav);
  git(["add", "theme.wav"], dir);
  fs.writeFileSync(path.join(dir, "theme.wav"), quietWav);

  const staged = await getPreviewDiffDocument(dir, "theme.wav", "staged");
  assert.deepEqual(readSide(staged.original), quietWav);
  assert.deepEqual(readSide(staged.current), loudWav);

  const unstaged = await getPreviewDiffDocument(dir, "theme.wav", "unstaged");
  assert.deepEqual(readSide(unstaged.original), loudWav);
  assert.deepEqual(readSide(unstaged.current), quietWav);
});

test("worktree 外のファイルは差分なしで返す", async (t) => {
  const dir = makeRepo(t);
  const outside = path.join(dir, "outside.wav");
  fs.writeFileSync(outside, quietWav);

  const document = await getPreviewFileDocument(outside);
  assert.equal(document.path, outside);
  assert.equal(document.original.contentId, document.current.contentId);
  assert.equal(sourcePath(document.current), outside);
  assert.equal(document.current.byteLength, quietWav.byteLength);

  assert.equal(await getPreviewFileDocument(path.join(dir, "missing.wav")), null);
  assert.equal(await getPreviewFileDocument(dir), null);
});
