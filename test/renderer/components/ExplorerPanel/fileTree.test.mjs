import assert from "node:assert/strict";
import test from "node:test";

import {
  ROOT_DIRECTORY_PATH,
  buildVisibleTreeRows,
  buildWatchTargets,
  normalizeExpandedDirectories,
  retainLoadedDirectories,
} from "../../../../src/renderer/components/ExplorerPanel/fileTree.ts";

function file(path) {
  return {
    id: path,
    path,
    name: path.split("/").pop() ?? path,
    kind: "file",
    children: null,
  };
}

function directory(path, children = []) {
  return {
    id: path,
    path,
    name: path.split("/").pop() ?? path,
    kind: "directory",
    children,
  };
}

const tree = [
  directory("docs", [file("docs/readme.md")]),
  directory("src", [
    directory("src/components", [
      file("src/components/Button.tsx"),
      file("src/components/Input.tsx"),
    ]),
    file("src/index.ts"),
  ]),
  file("package.json"),
];

test("normalizeExpandedDirectories は存在する path かつ祖先が開いているものだけ残す", () => {
  const expanded = normalizeExpandedDirectories(
    [
      "src/components",
      "docs",
      "missing",
      "src",
    ],
    tree,
  );

  assert.deepEqual(Array.from(expanded), ["docs", "src", "src/components"]);
});

test("normalizeExpandedDirectories は親が開いていない子孫 path を落とす", () => {
  const expanded = normalizeExpandedDirectories(["src/components"], tree);

  assert.deepEqual(Array.from(expanded), []);
});

test("buildVisibleTreeRows は展開中の directory だけを辿る", () => {
  const rows = buildVisibleTreeRows(tree, new Set(["src"]));

  assert.deepEqual(
    rows.map((row) => ({
      depth: row.depth,
      isOpen: row.isOpen,
      path: row.node.path,
    })),
    [
      { depth: 0, isOpen: false, path: "docs" },
      { depth: 0, isOpen: true, path: "src" },
      { depth: 1, isOpen: false, path: "src/components" },
      { depth: 1, isOpen: false, path: "src/index.ts" },
      { depth: 0, isOpen: false, path: "package.json" },
    ],
  );
});

test("buildVisibleTreeRows は展開済みの子孫 directory の中身も含める", () => {
  const rows = buildVisibleTreeRows(tree, new Set(["src", "src/components"]));

  assert.deepEqual(
    rows.map((row) => row.node.path),
    [
      "docs",
      "src",
      "src/components",
      "src/components/Button.tsx",
      "src/components/Input.tsx",
      "src/index.ts",
      "package.json",
    ],
  );
});

test("retainLoadedDirectories は root を維持しつつ消えた directory を落とす", () => {
  const loaded = retainLoadedDirectories(
    [ROOT_DIRECTORY_PATH, "src", "src/components", "missing"],
    tree,
  );

  assert.deepEqual(Array.from(loaded), [ROOT_DIRECTORY_PATH, "src", "src/components"]);
});

test("buildWatchTargets は root を常に含めて path をソートする", () => {
  const targets = buildWatchTargets(new Set(["src/components", "docs", "src"]));

  assert.deepEqual(targets, [ROOT_DIRECTORY_PATH, "docs", "src", "src/components"]);
});
