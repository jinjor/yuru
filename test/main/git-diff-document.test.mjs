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

function gitOutput(args, cwd, input) {
  return execFileSync("git", args, {
    cwd,
    env: cleanGitEnv(process.env),
    encoding: "utf8",
    input,
  }).trim();
}

function blobOid(content, cwd) {
  return gitOutput(["hash-object", "--stdin"], cwd, content);
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

function setDefaultBranch(dir, branch) {
  git(["update-ref", `refs/remotes/origin/${branch}`, `refs/heads/${branch}`], dir);
  git(["symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${branch}`], dir);
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
  assert.equal(emptyDoc.reviewSnapshot, undefined);

  // 作業ツリーから削除: current は null、original は HEAD の内容
  fs.rmSync(path.join(dir, "deleted.txt"));
  const deletedDoc = await getGitDiffDocument(dir, "deleted.txt");
  assert.equal(deletedDoc.currentContent, null);
  assert.equal(deletedDoc.originalContent, "line1\nline2\n");
});

test("review snapshot は表示した左右と merge-base 基準の OID を scope ごとに返す", async (t) => {
  const dir = makeRepo(t);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "base\n");
  commitAll(dir, "base");
  setDefaultBranch(dir, "main");
  const baseOid = gitOutput(["rev-parse", "HEAD:app.txt"], dir);

  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "head\n");
  commitAll(dir, "head");
  const headOid = gitOutput(["rev-parse", "HEAD:app.txt"], dir);

  fs.writeFileSync(path.join(dir, "app.txt"), "index\n");
  git(["add", "app.txt"], dir);
  const indexOid = gitOutput(["rev-parse", ":app.txt"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "worktree\n");
  const worktreeOid = blobOid("worktree\n", dir);

  const baseDocument = await getGitDiffDocument(dir, "app.txt", "base");
  assert.deepEqual(baseDocument.reviewSnapshot, {
    path: "app.txt",
    layer: "head",
    originalOid: baseOid,
    baseOid,
    approvedOid: headOid,
  });

  const stagedDocument = await getGitDiffDocument(dir, "app.txt", "staged");
  assert.deepEqual(stagedDocument.reviewSnapshot, {
    path: "app.txt",
    layer: "index",
    originalOid: headOid,
    baseOid,
    approvedOid: indexOid,
  });

  const unstagedDocument = await getGitDiffDocument(dir, "app.txt", "unstaged");
  assert.deepEqual(unstagedDocument.reviewSnapshot, {
    path: "app.txt",
    layer: "worktree",
    originalOid: indexOid,
    baseOid,
    approvedOid: worktreeOid,
  });

  const combinedDocument = await getGitDiffDocument(dir, "app.txt");
  assert.deepEqual(combinedDocument.reviewSnapshot, {
    path: "app.txt",
    layer: "worktree",
    originalOid: headOid,
    baseOid,
    approvedOid: worktreeOid,
  });
});

test("untracked file の snapshot は不在側を '-' にする", async (t) => {
  const dir = makeRepo(t);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], dir);
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  commitAll(dir, "base");
  setDefaultBranch(dir, "main");
  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "new.txt"), "new\n");

  const document = await getGitDiffDocument(dir, "new.txt", "unstaged");
  assert.deepEqual(document.reviewSnapshot, {
    path: "new.txt",
    layer: "worktree",
    originalOid: "-",
    baseOid: "-",
    approvedOid: blobOid("new\n", dir),
  });
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

test("base 表示は fork 元の内容と HEAD の内容を返し rename 元も解決する", async (t) => {
  const dir = makeRepo(t);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], dir);
  fs.writeFileSync(path.join(dir, "before.txt"), "line 1\nline 2\nline 3\n");
  commitAll(dir, "base");
  setDefaultBranch(dir, "main");
  const baseOid = gitOutput(["rev-parse", "HEAD:before.txt"], dir);
  git(["switch", "-c", "feature"], dir);
  git(["mv", "before.txt", "after.txt"], dir);
  fs.writeFileSync(path.join(dir, "after.txt"), "line 1\nfeature\nline 3\n");
  commitAll(dir, "feature");
  const approvedOid = gitOutput(["rev-parse", "HEAD:after.txt"], dir);

  const doc = await getGitDiffDocument(dir, "after.txt", "base");
  assert.equal(doc.originalContent, "line 1\nline 2\nline 3\n");
  assert.equal(doc.currentContent, "line 1\nfeature\nline 3\n");
  assert.deepEqual(doc.reviewSnapshot, {
    path: "after.txt",
    layer: "head",
    originalOid: baseOid,
    baseOid,
    approvedOid,
  });
});
