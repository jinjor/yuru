import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-review-state-"));
process.env.YURU_HOME = path.join(testRoot, "yuru-home");

const { removeFileReviews } = await import("../../src/main/file-reviews.ts");
const { getGitDiffDocument } = await import("../../src/main/git.ts");
const { getReviewState, setFileReviewed } = await import("../../src/main/review-state.ts");

function cleanGitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function git(args, cwd) {
  execFileSync("git", args, { cwd, env: cleanGitEnv(), stdio: "ignore" });
}

function makeRepo(name, defaultBranch = "main") {
  const dir = path.join(testRoot, `${name}-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(dir, { recursive: true });
  git(["init", "-b", defaultBranch], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "base\n");
  commitAll(dir, "base");
  git(["update-ref", `refs/remotes/origin/${defaultBranch}`, "HEAD"], dir);
  git(
    [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      `refs/remotes/origin/${defaultBranch}`,
    ],
    dir,
  );
  return dir;
}

function commitAll(dir, message) {
  git(["add", "."], dir);
  git(["-c", "commit.gpgsign=false", "commit", "-m", message], dir);
}

function scopeForLayer(layer) {
  return layer === "head" ? "base" : layer === "index" ? "staged" : "unstaged";
}

async function setCurrentFileReviewed(dir, filePath, layer, reviewed = true) {
  const scope = scopeForLayer(layer);
  const document = await getGitDiffDocument(dir, filePath, scope);
  assert.ok(document.reviewSnapshot);
  return setFileReviewed(dir, filePath, scope, reviewed, document.reviewSnapshot);
}

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("stacked branch も main からの全差分として Committed のレビューを導出する", async () => {
  const dir = makeRepo("stacked-from-main");
  git(["switch", "-c", "parent"], dir);
  fs.writeFileSync(path.join(dir, "parent.txt"), "parent\n");
  commitAll(dir, "parent");
  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "feature v1\n");
  commitAll(dir, "feature");

  let state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.baseBranch, "main");
  assert.deepEqual(
    state.committedFiles
      .map((file) => ({ path: file.path, reviewed: file.reviewed }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: "app.txt", reviewed: false },
      { path: "parent.txt", reviewed: false },
    ],
  );

  await setCurrentFileReviewed(dir, "app.txt", "head");
  state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.committedFiles.find((file) => file.path === "app.txt")?.reviewed, true);

  fs.writeFileSync(path.join(dir, "app.txt"), "feature v2\n");
  state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.committedFiles.find((file) => file.path === "app.txt")?.reviewed, true);
  assert.deepEqual(state.workingChecks, [
    { path: "app.txt", stagedReviewed: true, unstagedReviewed: false },
  ]);

  await setCurrentFileReviewed(dir, "app.txt", "worktree");
  state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.committedFiles.find((file) => file.path === "app.txt")?.reviewed, false);
  assert.equal(state.workingChecks[0].unstagedReviewed, true);

  commitAll(dir, "feature v2");
  state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.committedFiles.find((file) => file.path === "app.txt")?.reviewed, true);
  assert.deepEqual(state.workingChecks, []);
});

test("index でレビューした内容は commit 後の Committed 行へ引き継がれる", async () => {
  const dir = makeRepo("staged-transfer");
  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "staged\n");
  git(["add", "app.txt"], dir);

  await setCurrentFileReviewed(dir, "app.txt", "index");
  let state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.deepEqual(state.workingChecks, [
    { path: "app.txt", stagedReviewed: true, unstagedReviewed: true },
  ]);

  commitAll(dir, "feature");
  state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.committedFiles[0].reviewed, true);
});

test("scope なしの合算 diff は index 境界に依存せず worktree 内容をレビューする", async () => {
  const dir = makeRepo("combined-worktree-review");
  fs.writeFileSync(path.join(dir, "app.txt"), "staged\n");
  git(["add", "app.txt"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "worktree\n");

  const displayed = await getGitDiffDocument(dir, "app.txt");
  assert.ok(displayed.reviewSnapshot);
  assert.equal(displayed.reviewSnapshot.layer, "worktree");

  // 合算表示の左右 (HEAD ↔ worktree) は変えず、stage 境界だけを移動する。
  // 再検証も scope なしで行えば、表示していた内容をそのまま承認できる。
  git(["add", "app.txt"], dir);
  assert.deepEqual(
    await setFileReviewed(dir, "app.txt", undefined, true, displayed.reviewSnapshot),
    { kind: "updated" },
  );

  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.deepEqual(state.workingChecks, [
    { path: "app.txt", stagedReviewed: true, unstagedReviewed: true },
  ]);
});

test("untracked file の worktree 内容も Git blob OID として commit 後へ引き継がれる", async () => {
  const dir = makeRepo("untracked-transfer");
  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "new.txt"), "new file\n");

  await setCurrentFileReviewed(dir, "new.txt", "worktree");
  let state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.workingChecks.find((check) => check.path === "new.txt")?.unstagedReviewed, true);

  commitAll(dir, "add file");
  state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.deepEqual(
    state.committedFiles.map((file) => ({ path: file.path, status: file.status, reviewed: file.reviewed })),
    [{ path: "new.txt", status: "A", reviewed: true }],
  );
});

test("rename は移動先 path を key にしつつ fork 元 blob を fingerprint に使う", async () => {
  const dir = makeRepo("rename");
  git(["switch", "-c", "feature"], dir);
  git(["mv", "app.txt", "renamed.txt"], dir);
  commitAll(dir, "rename");

  await setCurrentFileReviewed(dir, "renamed.txt", "head");
  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.deepEqual(
    state.committedFiles.map((file) => ({ path: file.path, status: file.status, reviewed: file.reviewed })),
    [{ path: "renamed.txt", status: "R", reviewed: true }],
  );

  const store = JSON.parse(
    fs.readFileSync(path.join(process.env.YURU_HOME, "file-reviews.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(store.worktrees[path.resolve(dir)]), ["renamed.txt"]);

  removeFileReviews(dir);
  const removedStore = JSON.parse(
    fs.readFileSync(path.join(process.env.YURU_HOME, "file-reviews.json"), "utf8"),
  );
  assert.equal(removedStore.worktrees[path.resolve(dir)], undefined);
});

test("表示後に HEAD が進んだら古い Committed snapshot ではレビューしない", async () => {
  const dir = makeRepo("stale-committed");
  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "feature v2\n");
  commitAll(dir, "v2");

  const displayed = await getGitDiffDocument(dir, "app.txt", "base");
  assert.ok(displayed.reviewSnapshot);
  fs.writeFileSync(path.join(dir, "app.txt"), "feature v3\n");
  commitAll(dir, "v3");

  assert.deepEqual(
    await setFileReviewed(dir, "app.txt", "base", true, displayed.reviewSnapshot),
    { kind: "stale" },
  );
  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.committedFiles[0].reviewed, false);
});

test("表示後に index が変わったら古い Staged snapshot ではレビューしない", async () => {
  const dir = makeRepo("stale-staged");
  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "staged v2\n");
  git(["add", "app.txt"], dir);

  const displayed = await getGitDiffDocument(dir, "app.txt", "staged");
  assert.ok(displayed.reviewSnapshot);
  fs.writeFileSync(path.join(dir, "app.txt"), "staged v3\n");
  git(["add", "app.txt"], dir);

  assert.deepEqual(
    await setFileReviewed(dir, "app.txt", "staged", true, displayed.reviewSnapshot),
    { kind: "stale" },
  );
  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.workingChecks[0].stagedReviewed, false);
});

test("表示後に worktree が変わったら古い Unstaged snapshot ではレビューしない", async () => {
  const dir = makeRepo("stale-unstaged");
  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "worktree v2\n");

  const displayed = await getGitDiffDocument(dir, "app.txt", "unstaged");
  assert.ok(displayed.reviewSnapshot);
  fs.writeFileSync(path.join(dir, "app.txt"), "worktree v3\n");

  assert.deepEqual(
    await setFileReviewed(dir, "app.txt", "unstaged", true, displayed.reviewSnapshot),
    { kind: "stale" },
  );
  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.workingChecks[0].unstagedReviewed, false);
});

test("古い snapshot からの解除は新しい状態や既存 record を変更しない", async () => {
  const dir = makeRepo("stale-unreview");
  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "worktree v2\n");

  const displayed = await getGitDiffDocument(dir, "app.txt", "unstaged");
  assert.ok(displayed.reviewSnapshot);
  assert.deepEqual(
    await setFileReviewed(dir, "app.txt", "unstaged", true, displayed.reviewSnapshot),
    { kind: "updated" },
  );
  fs.writeFileSync(path.join(dir, "app.txt"), "worktree v3\n");

  assert.deepEqual(
    await setFileReviewed(dir, "app.txt", "unstaged", false, displayed.reviewSnapshot),
    { kind: "stale" },
  );
  fs.writeFileSync(path.join(dir, "app.txt"), "worktree v2\n");
  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.workingChecks[0].unstagedReviewed, true);
});

test("staged rename のレビューは commit 後の destination path へ引き継がれる", async () => {
  const dir = makeRepo("staged-rename-transfer");
  git(["switch", "-c", "feature"], dir);
  git(["mv", "app.txt", "renamed.txt"], dir);

  const displayed = await getGitDiffDocument(dir, "renamed.txt", "staged");
  assert.ok(displayed.reviewSnapshot);
  assert.deepEqual(
    await setFileReviewed(dir, "renamed.txt", "staged", true, displayed.reviewSnapshot),
    { kind: "updated" },
  );
  commitAll(dir, "rename");

  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.deepEqual(
    state.committedFiles.map((file) => ({
      path: file.path,
      status: file.status,
      reviewed: file.reviewed,
    })),
    [{ path: "renamed.txt", status: "R", reviewed: true }],
  );
});

test("main 自身も from main で空の Committed を返す", async () => {
  const dir = makeRepo("main");
  assert.deepEqual(await getReviewState(dir), {
    kind: "ready",
    baseBranch: "main",
    committedFiles: [],
    workingChecks: [],
  });
});

test("default branch が master の repository は from master にする", async () => {
  const dir = makeRepo("master-default", "master");
  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "feature.txt"), "feature\n");
  commitAll(dir, "feature");

  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.baseBranch, "master");
  assert.deepEqual(state.committedFiles.map((file) => file.path), ["feature.txt"]);
});

test("default branch を特定できなければ local main があっても no-base を返す", async () => {
  const dir = makeRepo("unknown-default");
  git(["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], dir);

  assert.deepEqual(await getReviewState(dir), { kind: "no-base" });
});

test("他の local branch が同じ commit を指していても main を表示する", async () => {
  const dir = makeRepo("ignore-other-branches");
  git(["branch", "aaa-sibling"], dir);
  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "feature.txt"), "feature\n");
  commitAll(dir, "feature");

  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.baseBranch, "main");
});

test("default branch が local に無ければ origin/main があっても no-base を返す", async () => {
  const dir = makeRepo("remote-default");
  git(["switch", "-c", "feature"], dir);
  git(["branch", "-D", "main"], dir);
  fs.writeFileSync(path.join(dir, "feature.txt"), "feature\n");
  commitAll(dir, "feature");

  const state = await getReviewState(dir);
  assert.deepEqual(state, { kind: "no-base" });
});

test("origin/main が local main より新しくても local main を基準にする", async () => {
  const dir = makeRepo("local-default");
  git(["switch", "--detach"], dir);
  fs.writeFileSync(path.join(dir, "base-only.txt"), "remote base\n");
  commitAll(dir, "remote base");
  git(["update-ref", "refs/remotes/origin/main", "HEAD"], dir);
  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "feature.txt"), "feature\n");
  commitAll(dir, "feature");

  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.baseBranch, "main");
  assert.deepEqual(
    state.committedFiles.map((file) => file.path).sort(),
    ["base-only.txt", "feature.txt"],
  );
});

test("複数 branch を merge した HEAD も main からの差分として扱う", async () => {
  const dir = makeRepo("merged-branches");
  git(["switch", "-c", "left"], dir);
  fs.writeFileSync(path.join(dir, "left.txt"), "left\n");
  commitAll(dir, "left");
  git(["switch", "main"], dir);
  git(["switch", "-c", "right"], dir);
  fs.writeFileSync(path.join(dir, "right.txt"), "right\n");
  commitAll(dir, "right");
  git(["switch", "-c", "feature", "left"], dir);
  git(["merge", "--no-ff", "right", "-m", "merge"], dir);

  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.baseBranch, "main");
  assert.deepEqual(
    state.committedFiles.map((file) => file.path).sort(),
    ["left.txt", "right.txt"],
  );
});

test("rebase しても fork 元で対象 file の blob が変わらなければレビューは残る", async () => {
  const dir = makeRepo("rebase-stable-base");
  git(["switch", "-c", "feature"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "feature\n");
  commitAll(dir, "feature");
  await setCurrentFileReviewed(dir, "app.txt", "head");

  git(["switch", "main"], dir);
  fs.writeFileSync(path.join(dir, "upstream.txt"), "upstream\n");
  commitAll(dir, "upstream");
  git(["switch", "feature"], dir);
  git(["rebase", "main"], dir);

  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.committedFiles.find((file) => file.path === "app.txt")?.reviewed, true);
});

test("rebase で fork 元の対象 file が変わればレビューは外れる", async () => {
  const dir = makeRepo("rebase-changed-base");
  const baseLines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
  fs.writeFileSync(path.join(dir, "app.txt"), `${baseLines.join("\n")}\n`);
  commitAll(dir, "multi-line base");

  git(["switch", "-c", "feature"], dir);
  const featureLines = [...baseLines];
  featureLines[17] = "feature line";
  fs.writeFileSync(path.join(dir, "app.txt"), `${featureLines.join("\n")}\n`);
  commitAll(dir, "feature");
  await setCurrentFileReviewed(dir, "app.txt", "head");

  git(["switch", "main"], dir);
  const upstreamLines = [...baseLines];
  upstreamLines[1] = "upstream line";
  fs.writeFileSync(path.join(dir, "app.txt"), `${upstreamLines.join("\n")}\n`);
  commitAll(dir, "upstream");
  git(["switch", "feature"], dir);
  git(["rebase", "main"], dir);

  const state = await getReviewState(dir);
  assert.equal(state.kind, "ready");
  assert.equal(state.committedFiles.find((file) => file.path === "app.txt")?.reviewed, false);
});
