import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readWorktreeFile } from "../../src/main/files.ts";
import { getGitDiffDocument } from "../../src/main/git.ts";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-diff-"));
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

test("getGitDiffDocument は空ファイル ('') と削除ファイル (null) を区別する", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "empty.txt"), "");
  fs.writeFileSync(path.join(dir, "deleted.txt"), "line1\nline2\n");
  commitAll(dir, "init");

  // 空ファイルは変更なし: current は "" (存在する)、original も ""
  const emptyDoc = await getGitDiffDocument(dir, "empty.txt");
  assert.equal(emptyDoc.currentContent, "");
  assert.equal(emptyDoc.originalContent, "");

  // 作業ツリーから削除: current は null、original は HEAD の内容
  fs.rmSync(path.join(dir, "deleted.txt"));
  const deletedDoc = await getGitDiffDocument(dir, "deleted.txt");
  assert.equal(deletedDoc.currentContent, null);
  assert.equal(deletedDoc.originalContent, "line1\nline2\n");
});

test("staged 表示の current は index 内容、編集 seed は作業ツリー内容で、ガター base は index", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "a.txt"), "v1\n");
  commitAll(dir, "init");
  // index に v2 を stage し、その後 worktree を v3 にする (index と worktree がずれた状態)
  fs.writeFileSync(path.join(dir, "a.txt"), "v2\n");
  git(["add", "a.txt"], dir);
  fs.writeFileSync(path.join(dir, "a.txt"), "v3\n");

  // 閲覧の staged 差分の current 側は index の内容
  const stagedDoc = await getGitDiffDocument(dir, "a.txt", "staged");
  assert.equal(stagedDoc.currentContent, "v2\n");

  // 編集モードの seed は作業ツリーの実ファイル (index ではない)
  assert.equal(await readWorktreeFile(dir, "a.txt"), "v3\n");

  // 編集中のガター base は unstaged の元 = index の内容
  const unstagedDoc = await getGitDiffDocument(dir, "a.txt", "unstaged");
  assert.equal(unstagedDoc.originalContent, "v2\n");
  assert.equal(unstagedDoc.currentContent, "v3\n");
});

test("getGitDiffDocument は新規追加ファイルの original を null にする", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  commitAll(dir, "init");

  fs.writeFileSync(path.join(dir, "added.txt"), "new content\n");
  const doc = await getGitDiffDocument(dir, "added.txt");
  assert.equal(doc.originalContent, null);
  assert.equal(doc.currentContent, "new content\n");
});
