import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readWorktreeFile,
  resolveHtmlPreviewEntry,
  resolveRepoPath,
  writeFile,
} from "../../../src/main/files/files.ts";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yuru-files-"));
}

test("resolveRepoPath は worktree 内のファイルとディレクトリを相対パスで返す", async () => {
  const dir = makeTempDir();
  fs.mkdirSync(path.join(dir, "src", "renderer"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "app.ts"), "");

  assert.deepEqual(await resolveRepoPath(dir, "src/app.ts"), { kind: "file", path: "src/app.ts" });
  assert.deepEqual(await resolveRepoPath(dir, "./src/app.ts"), {
    kind: "file",
    path: "src/app.ts",
  });
  assert.deepEqual(await resolveRepoPath(dir, path.join(dir, "src", "app.ts")), {
    kind: "file",
    path: "src/app.ts",
  });
  assert.deepEqual(await resolveRepoPath(dir, "src/renderer"), {
    kind: "directory",
    path: "src/renderer",
  });
  assert.deepEqual(await resolveRepoPath(dir, "src/"), { kind: "directory", path: "src" });
  assert.deepEqual(await resolveRepoPath(dir, path.join(dir, "src", "renderer")), {
    kind: "directory",
    path: "src/renderer",
  });
  assert.deepEqual(await resolveRepoPath(dir, dir), { kind: "directory", path: "" });
});

test("resolveRepoPath は .. で始まる名前を worktree の外とみなさない", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "..notes.txt"), "");

  assert.deepEqual(await resolveRepoPath(dir, "..notes.txt"), {
    kind: "file",
    path: "..notes.txt",
  });
});

test("resolveRepoPath は相対パスを repo root 基準で解決しない", async () => {
  const repoRoot = makeTempDir();
  const worktreePath = path.join(repoRoot, ".yuru", "worktrees", "task-a");
  fs.mkdirSync(path.join(worktreePath, "src"), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, "src", "app.ts"), "");
  fs.writeFileSync(path.join(repoRoot, "root.txt"), "");

  assert.equal(await resolveRepoPath(worktreePath, ".yuru/worktrees/task-a/src/app.ts"), null);
  assert.equal(await resolveRepoPath(worktreePath, "root.txt"), null);
});

test("resolveRepoPath は worktree 内の不在パスを null で返す", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "app.ts"), "");

  assert.equal(await resolveRepoPath(dir, "missing.ts"), null);
  assert.equal(await resolveRepoPath(dir, "missing/"), null);
  assert.equal(await resolveRepoPath(dir, "app.ts/inner"), null);
});

test("resolveRepoPath は worktree 外の実在ファイルを絶対パスで返す", async () => {
  const dir = makeTempDir();
  const outside = makeTempDir();
  const outsideFile = path.join(outside, "mock.html");
  fs.writeFileSync(outsideFile, "<html></html>");

  assert.deepEqual(await resolveRepoPath(dir, outsideFile), { kind: "file", path: outsideFile });
});

test("resolveRepoPath は .. で worktree の外に出る相対パスを外のパスとして扱う", async () => {
  const dir = makeTempDir();
  const outside = makeTempDir();
  const outsideFile = path.join(outside, "escape.txt");
  fs.writeFileSync(outsideFile, "x");

  assert.deepEqual(await resolveRepoPath(dir, path.relative(dir, outsideFile)), {
    kind: "file",
    path: outsideFile,
  });
  assert.equal(await resolveRepoPath(dir, path.relative(dir, outside)), null);
});

test("resolveRepoPath は worktree 外のディレクトリと不在パスを null で返す", async () => {
  const dir = makeTempDir();
  const outside = makeTempDir();

  assert.equal(await resolveRepoPath(dir, outside), null);
  assert.equal(await resolveRepoPath(dir, path.join(outside, "missing.txt")), null);
});

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

test("resolveHtmlPreviewEntry は worktree 内のファイルに worktree ルートを返す", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "page.html"), "<html></html>");

  assert.deepEqual(await resolveHtmlPreviewEntry(dir, "page.html"), {
    root: dir,
    path: "page.html",
  });
});

test("resolveHtmlPreviewEntry は worktree 外のファイルに親ディレクトリを root として返す", async () => {
  const dir = makeTempDir();
  const outside = makeTempDir();
  const outsideFile = path.join(outside, "mock.html");
  fs.writeFileSync(outsideFile, "<html></html>");

  assert.deepEqual(await resolveHtmlPreviewEntry(dir, outsideFile), {
    root: outside,
    path: "mock.html",
  });
});

test("resolveHtmlPreviewEntry は開けないパスを null で返す", async () => {
  const dir = makeTempDir();
  const outside = makeTempDir();
  fs.mkdirSync(path.join(dir, "pages"));

  assert.equal(await resolveHtmlPreviewEntry(dir, path.join(outside, "missing.html")), null);
  assert.equal(await resolveHtmlPreviewEntry(dir, "pages"), null);
});
