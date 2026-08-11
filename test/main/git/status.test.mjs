import assert from "node:assert/strict";
import test from "node:test";

import { parsePorcelainLine } from "../../../src/main/git/status.ts";

test("parsePorcelainLine は staged と unstaged を分けて解釈する", () => {
  assert.deepEqual(parsePorcelainLine("M  src/app.ts"), {
    path: "src/app.ts",
    indexStatus: "M",
    worktreeStatus: "",
    conflicted: false,
    ignored: false,
  });

  assert.deepEqual(parsePorcelainLine(" M src/app.ts"), {
    path: "src/app.ts",
    indexStatus: "",
    worktreeStatus: "M",
    conflicted: false,
    ignored: false,
  });

  assert.deepEqual(parsePorcelainLine("MM src/app.ts"), {
    path: "src/app.ts",
    indexStatus: "M",
    worktreeStatus: "M",
    conflicted: false,
    ignored: false,
  });
});

test("parsePorcelainLine は untracked と ignored を特別扱いする", () => {
  assert.deepEqual(parsePorcelainLine("?? notes/todo.md"), {
    path: "notes/todo.md",
    indexStatus: "",
    worktreeStatus: "??",
    conflicted: false,
    ignored: false,
  });

  assert.deepEqual(parsePorcelainLine("!! dist/app.js"), {
    path: "dist/app.js",
    indexStatus: "",
    worktreeStatus: "",
    conflicted: false,
    ignored: true,
  });
});

test("parsePorcelainLine は rename の移動先 path を使う", () => {
  assert.deepEqual(parsePorcelainLine("R  old/name.ts -> new/name.ts"), {
    path: "new/name.ts",
    indexStatus: "R",
    worktreeStatus: "",
    conflicted: false,
    ignored: false,
  });
});

test("parsePorcelainLine は unmerged な status を conflicted として解釈する", () => {
  for (const rawStatus of ["DD", "AU", "UD", "UA", "DU", "AA", "UU"]) {
    assert.deepEqual(parsePorcelainLine(`${rawStatus} src/app.ts`), {
      path: "src/app.ts",
      indexStatus: "",
      worktreeStatus: "",
      conflicted: true,
      ignored: false,
    });
  }
});
