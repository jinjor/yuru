import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readWorktreeFile, resolveHtmlPreviewEntry, resolveRepoFile, writeFile } from "../../src/main/files.ts";

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

test("resolveRepoFile は worktree 内のファイルを相対パスで返す", () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "a.txt"), "hello");

  assert.equal(resolveRepoFile(dir, "a.txt"), "a.txt");
  assert.equal(resolveRepoFile(dir, path.join(dir, "a.txt")), "a.txt");
});

test("resolveRepoFile は worktree 外の実在ファイルを絶対パスのまま返す", () => {
  const dir = makeTempDir();
  const outside = makeTempDir();
  const outsideFile = path.join(outside, "mock.html");
  fs.writeFileSync(outsideFile, "<html></html>");

  assert.equal(resolveRepoFile(dir, outsideFile), outsideFile);
});

test("resolveRepoFile は worktree 外の不在ファイルとディレクトリを null で返す", () => {
  const dir = makeTempDir();
  const outside = makeTempDir();

  assert.equal(resolveRepoFile(dir, path.join(outside, "missing.txt")), null);
  assert.equal(resolveRepoFile(dir, outside), null);
});

test("resolveRepoFile は相対パスでの worktree 外への脱出を null で返す", () => {
  const dir = makeTempDir();
  const outside = makeTempDir();
  fs.writeFileSync(path.join(outside, "escape.txt"), "x");
  const escapePath = path.relative(dir, path.join(outside, "escape.txt"));

  assert.equal(resolveRepoFile(dir, escapePath), null);
  assert.equal(resolveRepoFile(dir, "../escape.txt"), null);
});

test("resolveHtmlPreviewEntry は worktree 内のファイルに worktree ルートを返す", () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "page.html"), "<html></html>");

  assert.deepEqual(resolveHtmlPreviewEntry(dir, "page.html"), { root: dir, path: "page.html" });
});

test("resolveHtmlPreviewEntry は worktree 外のファイルに親ディレクトリを root として返す", () => {
  const dir = makeTempDir();
  const outside = makeTempDir();
  const outsideFile = path.join(outside, "mock.html");
  fs.writeFileSync(outsideFile, "<html></html>");

  assert.deepEqual(resolveHtmlPreviewEntry(dir, outsideFile), {
    root: outside,
    path: "mock.html",
  });
});

test("resolveHtmlPreviewEntry は開けないパスを null で返す", () => {
  const dir = makeTempDir();
  const outside = makeTempDir();

  assert.equal(resolveHtmlPreviewEntry(dir, path.join(outside, "missing.html")), null);
});
