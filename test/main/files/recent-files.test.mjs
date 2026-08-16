import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-recent-files-test-"));
process.env.YURU_HOME = tempDir;

const storePath = path.join(tempDir, "recent-files.json");
const { addRecentFile, loadRecentFiles } = await import("../../../src/main/files/recent-files.ts");

function reset() {
  fs.rmSync(storePath, { force: true });
}

test("returns an empty history when nothing was opened", () => {
  reset();
  assert.deepEqual(loadRecentFiles("/repo"), []);
});

test("keeps the most recently opened file first", () => {
  reset();
  addRecentFile("/repo", "src/a.ts");
  addRecentFile("/repo", "src/b.ts");
  assert.deepEqual(loadRecentFiles("/repo"), ["src/b.ts", "src/a.ts"]);
});

test("moves an already recorded file to the front instead of duplicating it", () => {
  reset();
  addRecentFile("/repo", "src/a.ts");
  addRecentFile("/repo", "src/b.ts");
  addRecentFile("/repo", "src/a.ts");
  assert.deepEqual(loadRecentFiles("/repo"), ["src/a.ts", "src/b.ts"]);
});

test("drops the oldest entries beyond the limit", () => {
  reset();
  for (let index = 0; index < 60; index++) {
    addRecentFile("/repo", `src/file-${index}.ts`);
  }
  const recent = loadRecentFiles("/repo");
  assert.equal(recent.length, 50);
  assert.equal(recent[0], "src/file-59.ts");
  assert.equal(recent[49], "src/file-10.ts");
});

test("keeps histories of different repos apart", () => {
  reset();
  addRecentFile("/repo/one", "src/a.ts");
  addRecentFile("/repo/two", "src/b.ts");
  assert.deepEqual(loadRecentFiles("/repo/one"), ["src/a.ts"]);
  assert.deepEqual(loadRecentFiles("/repo/two"), ["src/b.ts"]);
});

test("reads and writes the history under the same resolved repo path", () => {
  reset();
  addRecentFile("/repo/one/", "src/a.ts");
  assert.deepEqual(loadRecentFiles("/repo/one"), ["src/a.ts"]);
});

test("rejects a malformed store instead of silently starting over", () => {
  reset();
  fs.writeFileSync(storePath, JSON.stringify({ repos: { "/repo": "src/a.ts" } }));
  assert.throws(() => loadRecentFiles("/repo"), /must be an array/);
});
