import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { getGitPathStates, parsePorcelainZ } from "../../../src/main/git/status.ts";

test("parsePorcelainZ は staged と unstaged を分けて解釈する", () => {
  assert.deepEqual(parsePorcelainZ("M  src/app.ts")[0], {
    path: "src/app.ts",
    indexStatus: "M",
    worktreeStatus: "",
    conflicted: false,
    ignored: false,
  });

  assert.deepEqual(parsePorcelainZ(" M src/app.ts")[0], {
    path: "src/app.ts",
    indexStatus: "",
    worktreeStatus: "M",
    conflicted: false,
    ignored: false,
  });

  assert.deepEqual(parsePorcelainZ("MM src/app.ts")[0], {
    path: "src/app.ts",
    indexStatus: "M",
    worktreeStatus: "M",
    conflicted: false,
    ignored: false,
  });
});

test("parsePorcelainZ は untracked と ignored を特別扱いする", () => {
  assert.deepEqual(parsePorcelainZ("?? notes/todo.md")[0], {
    path: "notes/todo.md",
    indexStatus: "",
    worktreeStatus: "??",
    conflicted: false,
    ignored: false,
  });

  assert.deepEqual(parsePorcelainZ("!! dist/app.js")[0], {
    path: "dist/app.js",
    indexStatus: "",
    worktreeStatus: "",
    conflicted: false,
    ignored: true,
  });
});

test("parsePorcelainZ は rename の移動先 path を使う", () => {
  assert.deepEqual(parsePorcelainZ("R  new/name.ts\0old/name.ts\0")[0], {
    path: "new/name.ts",
    indexStatus: "R",
    worktreeStatus: "",
    conflicted: false,
    ignored: false,
  });
});

test("parsePorcelainZ は unmerged な status を conflicted として解釈する", () => {
  for (const rawStatus of ["DD", "AU", "UD", "UA", "DU", "AA", "UU"]) {
    assert.deepEqual(parsePorcelainZ(`${rawStatus} src/app.ts`)[0], {
      path: "src/app.ts",
      indexStatus: "",
      worktreeStatus: "",
      conflicted: true,
      ignored: false,
    });
  }
});

test("parsePorcelainZ は日本語のパスをクォートせずに扱う", () => {
  assert.deepEqual(parsePorcelainZ("!! メモ/日本語.md\0?? 新規.txt\0"), [
    { path: "メモ/日本語.md", indexStatus: "", worktreeStatus: "", conflicted: false, ignored: true },
    { path: "新規.txt", indexStatus: "", worktreeStatus: "??", conflicted: false, ignored: false },
  ]);
});


test("両方の層に変更がある場合の合算行数は、HEAD と作業ツリーを比較する", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-combined-stats-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git("init");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  const file = path.join(cwd, "note.txt");
  fs.writeFileSync(file, "original\n");
  git("add", ".");
  git("commit", "-m", "initial");
  fs.writeFileSync(file, "staged\n");
  git("add", ".");
  fs.writeFileSync(file, "original\n");
  let [state] = await getGitPathStates(cwd);
  assert.deepEqual(state.stagedLineStat, { added: 1, deleted: 1 });
  assert.deepEqual(state.unstagedLineStat, { added: 1, deleted: 1 });
  assert.equal(state.combinedLineStat, undefined);
  fs.writeFileSync(file, "current\nextra\n");
  [state] = await getGitPathStates(cwd);
  assert.deepEqual(state.combinedLineStat, { added: 2, deleted: 1 });
});

test("初回 commit 前の staged + unstaged の合算行数は作業ツリーの行数になる", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-unborn-stats-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd, stdio: "pipe" });
  const file = path.join(cwd, "note.txt");
  fs.writeFileSync(file, "staged\n");
  execFileSync("git", ["add", "."], { cwd, stdio: "pipe" });
  fs.writeFileSync(file, "current\nextra\n");
  const [state] = await getGitPathStates(cwd);
  assert.deepEqual(state.combinedLineStat, { added: 2, deleted: 0 });
});
