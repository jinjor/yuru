import assert from "node:assert/strict";
import test from "node:test";

import { buildChangeSections } from "../../../src/renderer/changes/changes.ts";

test("buildChangeSections は空のセクションを省く", () => {
  assert.deepEqual(
    buildChangeSections({
      conflictedFiles: [],
      committedFiles: [],
      stagedFiles: [],
      unstagedFiles: [{ path: "src/app.ts", status: "M" }],
    }),
    [
      {
        key: "unstaged",
        label: "Unstaged",
        files: [{ path: "src/app.ts", status: "M" }],
        totalLineStat: { added: 0, deleted: 0 },
      },
    ],
  );
});

test("buildChangeSections は section ごとに行数を合計する", () => {
  const sections = buildChangeSections({
    conflictedFiles: [],
    committedFiles: [],
    stagedFiles: [
      { path: "src/a.ts", status: "M", lineStat: { added: 2, deleted: 1 } },
      { path: "assets/icon.png", status: "A" },
    ],
    unstagedFiles: [
      { path: "src/b.ts", status: "M", lineStat: { added: 3, deleted: 4 } },
      { path: "notes/todo.md", status: "??", lineStat: { added: 5, deleted: 0 } },
    ],
  });

  assert.deepEqual(
    sections.map((section) => section.totalLineStat),
    [
      { added: 2, deleted: 1 },
      { added: 8, deleted: 4 },
    ],
  );
});

test("buildChangeSections は両方に変更があるときだけ 2 セクション返す", () => {
  assert.deepEqual(
    buildChangeSections({
      conflictedFiles: [],
      committedFiles: [],
      stagedFiles: [{ path: "src/staged.ts", status: "M" }],
      unstagedFiles: [{ path: "src/unstaged.ts", status: "M" }],
    }).map((section) => section.key),
    ["staged", "unstaged"],
  );
});

test("buildChangeSections は conflicted を先頭の section として返す", () => {
  const sections = buildChangeSections({
    conflictedFiles: [{ path: "src/conflict.ts", status: "!", lineStat: { added: 4, deleted: 0 } }],
    committedFiles: [{ path: "src/committed.ts", status: "M" }],
    stagedFiles: [{ path: "src/staged.ts", status: "M" }],
    unstagedFiles: [{ path: "src/unstaged.ts", status: "M" }],
  });

  assert.deepEqual(
    sections.map((section) => section.key),
    ["conflicted", "base", "staged", "unstaged"],
  );
  assert.deepEqual(sections[0].totalLineStat, { added: 4, deleted: 0 });
});
