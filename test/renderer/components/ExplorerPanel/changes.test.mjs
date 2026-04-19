import assert from "node:assert/strict";
import test from "node:test";

import { buildChangeSections } from "../../../../src/renderer/components/ExplorerPanel/changes.ts";

test("buildChangeSections は空のセクションを省く", () => {
  assert.deepEqual(
    buildChangeSections({
      stagedFiles: [],
      unstagedFiles: [{ path: "src/app.ts", status: "M" }],
    }),
    [
      {
        key: "unstaged",
        label: "Unstaged",
        files: [{ path: "src/app.ts", status: "M" }],
      },
    ],
  );
});

test("buildChangeSections は両方に変更があるときだけ 2 セクション返す", () => {
  assert.deepEqual(
    buildChangeSections({
      stagedFiles: [{ path: "src/staged.ts", status: "M" }],
      unstagedFiles: [{ path: "src/unstaged.ts", status: "M" }],
    }).map((section) => section.key),
    ["staged", "unstaged"],
  );
});
