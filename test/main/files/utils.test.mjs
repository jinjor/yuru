import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolvePathUnderRoot, statRegularFile } from "../../../src/main/files/utils.ts";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yuru-file-utils-"));
}

test("resolvePathUnderRoot はルートの下のパスを絶対パスにし、外に出るパスを拒否する", () => {
  const root = makeTempDir();

  assert.equal(resolvePathUnderRoot(root), root);
  assert.equal(resolvePathUnderRoot(root, "a/b.txt"), path.join(root, "a", "b.txt"));
  assert.throws(() => resolvePathUnderRoot(root, ".."), /Invalid path/);
  assert.throws(() => resolvePathUnderRoot(root, "a/../../b"), /Invalid path/);
});

test("statRegularFile は通常ファイルだけを返し、不在とディレクトリは null にする", async () => {
  const root = makeTempDir();
  fs.writeFileSync(path.join(root, "file.txt"), "x");

  assert.equal((await statRegularFile(path.join(root, "file.txt")))?.isFile(), true);
  assert.equal(await statRegularFile(root), null);
  assert.equal(await statRegularFile(path.join(root, "missing.txt")), null);
  assert.equal(await statRegularFile(path.join(root, "file.txt", "inner")), null);
});
