import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hasDotGit } from "../../../src/main/git/repo.ts";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yuru-git-repo-"));
}

test("hasDotGit は直下の .git ファイルと .git ディレクトリを認める", async () => {
  const linkedWorktree = makeTempDir();
  fs.writeFileSync(path.join(linkedWorktree, ".git"), "gitdir: /repo/.git/worktrees/task\n");
  const mainWorktree = makeTempDir();
  fs.mkdirSync(path.join(mainWorktree, ".git"));

  assert.equal(await hasDotGit(linkedWorktree), true);
  assert.equal(await hasDotGit(mainWorktree), true);
});

test("hasDotGit は .git の無いディレクトリと、無いディレクトリを認めない", async () => {
  const plainDirectory = makeTempDir();
  fs.mkdirSync(path.join(plainDirectory, "sub"));

  assert.equal(await hasDotGit(plainDirectory), false);
  assert.equal(await hasDotGit(path.join(plainDirectory, "sub")), false);
  assert.equal(await hasDotGit(path.join(plainDirectory, "missing")), false);
});
