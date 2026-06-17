import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readWorktreeFile, writeFile } from "../../src/main/files.ts";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yuru-files-"));
}

test("readWorktreeFile は既存ファイルの内容を返す", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "a.txt"), "hello\nworld\n");

  assert.equal(await readWorktreeFile(dir, "a.txt"), "hello\nworld\n");
});

test("readWorktreeFile は空ファイルを '' で返す", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "empty.txt"), "");

  assert.equal(await readWorktreeFile(dir, "empty.txt"), "");
});

test("readWorktreeFile は存在しないファイルを null で返す", async () => {
  const dir = makeTempDir();

  assert.equal(await readWorktreeFile(dir, "missing.txt"), null);
});

test("readWorktreeFile は worktree の外を拒否する", async () => {
  const dir = makeTempDir();

  await assert.rejects(() => readWorktreeFile(dir, "../escape.txt"), /Invalid path/);
});

test("writeFile は既存ファイルを更新する", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "a.txt"), "old content");

  await writeFile(dir, "a.txt", "new content");

  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "new content");
});

test("writeFile は長い内容を短い内容で上書きしても残骸を残さない", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "a.txt"), "a fairly long original content");

  await writeFile(dir, "a.txt", "short");

  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "short");
});

test("writeFile は存在しないファイルを作成せず ENOENT で失敗する", async () => {
  const dir = makeTempDir();

  await assert.rejects(
    () => writeFile(dir, "missing.txt", "x"),
    (error) => error.code === "ENOENT",
  );
  assert.equal(fs.existsSync(path.join(dir, "missing.txt")), false);
});

test("writeFile は worktree の外への書き込みを拒否する", async () => {
  const dir = makeTempDir();

  await assert.rejects(() => writeFile(dir, "../escape.txt", "x"), /Invalid path/);
});
