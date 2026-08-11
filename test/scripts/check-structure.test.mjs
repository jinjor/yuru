import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findSiblingDirectoryCycles } from "../../scripts/check-structure.mjs";

const checkStructureScript = path.resolve("scripts/check-structure.mjs");

function createSourceTree(t, files) {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-structure-"));
  t.after(() => {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  });

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  return rootDirectory;
}

function cycleDirectoryNames(cycle) {
  return [
    ...cycle.dependencies.map((dependency) => dependency.fromDirectory),
    cycle.dependencies.at(-1).toDirectory,
  ];
}

test("一方向だけの兄弟ディレクトリ依存は許可する", (t) => {
  const rootDirectory = createSourceTree(t, {
    "features/alpha/index.ts": 'import { beta } from "../beta/index.js";\nexport { beta };\n',
    "features/beta/index.ts": "export const beta = 1;\n",
  });

  assert.deepEqual(findSiblingDirectoryCycles(rootDirectory), []);
});

test("兄弟ディレクトリ間の循環依存を検出する", (t) => {
  const rootDirectory = createSourceTree(t, {
    "features/alpha/index.ts": 'import { beta } from "../beta/index.js";\nexport { beta };\n',
    "features/beta/index.ts": 'import { alpha } from "../alpha/index.js";\nexport { alpha };\n',
  });

  const [cycle] = findSiblingDirectoryCycles(rootDirectory);

  assert.equal(cycle.parentDirectory, path.join(rootDirectory, "features"));
  assert.deepEqual(cycle.directories, ["alpha", "beta"]);
  assert.deepEqual(cycleDirectoryNames(cycle), ["alpha", "beta", "alpha"]);
});

test("3つの兄弟ディレクトリをまたぐ循環依存を検出する", (t) => {
  const rootDirectory = createSourceTree(t, {
    "features/alpha/index.ts": 'export { beta } from "../beta/index.js";\n',
    "features/beta/index.ts": 'export { gamma } from "../gamma/index.js";\n',
    "features/gamma/index.ts": 'export { alpha } from "../alpha/index.js";\n',
  });

  const [cycle] = findSiblingDirectoryCycles(rootDirectory);

  assert.deepEqual(cycle.directories, ["alpha", "beta", "gamma"]);
  assert.deepEqual(cycleDirectoryNames(cycle), ["alpha", "beta", "gamma", "alpha"]);
});

test("深さが違うファイル間の依存も共通の親を持つ兄弟ディレクトリとして扱う", (t) => {
  const rootDirectory = createSourceTree(t, {
    "features/alpha/internal/index.ts":
      'import { beta } from "../../beta/index.js";\nexport { beta };\n',
    "features/beta/index.ts":
      'import { alpha } from "../alpha/internal/index.js";\nexport { alpha };\n',
  });

  const [cycle] = findSiblingDirectoryCycles(rootDirectory);

  assert.equal(cycle.parentDirectory, path.join(rootDirectory, "features"));
  assert.deepEqual(cycleDirectoryNames(cycle), ["alpha", "beta", "alpha"]);
});

test("型だけの import もディレクトリ依存に数える", (t) => {
  const rootDirectory = createSourceTree(t, {
    "features/alpha/index.ts":
      'import type { Beta } from "../beta/index.js";\nexport type Alpha = Beta;\n',
    "features/beta/index.ts":
      'import { type Alpha } from "../alpha/index.js";\nexport interface Beta { alpha: Alpha }\n',
  });

  const [cycle] = findSiblingDirectoryCycles(rootDirectory);

  assert.deepEqual(cycleDirectoryNames(cycle), ["alpha", "beta", "alpha"]);
});

test("型だけの re-export もディレクトリ依存に数える", (t) => {
  const rootDirectory = createSourceTree(t, {
    "features/alpha/index.ts": 'export type { Beta } from "../beta/index.js";\n',
    "features/beta/index.ts": 'export type { Alpha } from "../alpha/index.js";\n',
  });

  const [cycle] = findSiblingDirectoryCycles(rootDirectory);

  assert.deepEqual(cycleDirectoryNames(cycle), ["alpha", "beta", "alpha"]);
});

test("型宣言ファイルからの依存もディレクトリ依存に数える", (t) => {
  const rootDirectory = createSourceTree(t, {
    "features/alpha/index.d.ts": 'export type { Beta } from "../beta/index.js";\n',
    "features/beta/index.ts": 'export type { Alpha } from "../alpha/index.js";\n',
  });

  const [cycle] = findSiblingDirectoryCycles(rootDirectory);

  assert.deepEqual(cycleDirectoryNames(cycle), ["alpha", "beta", "alpha"]);
});

test("import() 型からの依存もディレクトリ依存に数える", (t) => {
  const rootDirectory = createSourceTree(t, {
    "features/alpha/index.ts": 'export type Alpha = import("../beta/index.js").Beta;\n',
    "features/beta/index.ts": 'export type Beta = import("../alpha/index.js").Alpha;\n',
  });

  const [cycle] = findSiblingDirectoryCycles(rootDirectory);

  assert.deepEqual(cycleDirectoryNames(cycle), ["alpha", "beta", "alpha"]);
});

test("文字列リテラルの dynamic import もディレクトリ依存に数える", (t) => {
  const rootDirectory = createSourceTree(t, {
    "features/alpha/index.ts":
      'export async function loadBeta() { return import("../beta/index.js"); }\n',
    "features/beta/index.ts": 'export { loadBeta } from "../alpha/index.js";\n',
  });

  const [cycle] = findSiblingDirectoryCycles(rootDirectory);

  assert.deepEqual(cycleDirectoryNames(cycle), ["alpha", "beta", "alpha"]);
});

test("同じディレクトリ内のファイル循環は兄弟ディレクトリ循環に数えない", (t) => {
  const rootDirectory = createSourceTree(t, {
    "features/alpha/one.ts": 'import { two } from "./two.js";\nexport { two };\n',
    "features/alpha/two.ts": 'import { one } from "./one.js";\nexport { one };\n',
  });

  assert.deepEqual(findSiblingDirectoryCycles(rootDirectory), []);
});

test("ルート直下のファイルは兄弟ディレクトリとして扱わない", (t) => {
  const rootDirectory = createSourceTree(t, {
    "index.ts": 'import { alpha } from "./alpha/index.js";\nexport { alpha };\n',
    "alpha/index.ts": 'import { root } from "../index.js";\nexport { root };\n',
  });

  assert.deepEqual(findSiblingDirectoryCycles(rootDirectory), []);
});

test("CLI は循環経路と原因の import を表示して失敗する", (t) => {
  const rootDirectory = createSourceTree(t, {
    "features/alpha/index.ts": 'import { beta } from "../beta/index.js";\nexport { beta };\n',
    "features/beta/index.ts": 'import { alpha } from "../alpha/index.js";\nexport { alpha };\n',
  });

  const result = spawnSync(process.execPath, [checkStructureScript, rootDirectory], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /sibling directory cycle: alpha -> beta -> alpha/);
  assert.match(result.stderr, /features\/alpha\/index\.ts imports .*features\/beta\/index\.ts/);
});
