import assert from "node:assert/strict";
import test from "node:test";

import { parsePorcelainZ } from "../../../src/main/git/status.ts";

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
