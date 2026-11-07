import assert from "node:assert/strict";
import test from "node:test";

import {
  splitDirectoryPath,
  toAbsolutePath,
  toRootRelativePath,
} from "../../../src/renderer/utils/filePath.ts";

test("toRootRelativePath はルートの下のパスだけを相対パスにする", () => {
  assert.equal(toRootRelativePath("/tmp/out", "/tmp/out"), "");
  assert.equal(toRootRelativePath("/tmp/out", "/tmp/out/logs/run.log"), "logs/run.log");
  assert.equal(toRootRelativePath("/tmp/out", "/tmp/output/a.md"), null);
  assert.equal(toRootRelativePath("/tmp/out", "/tmp"), null);
  assert.equal(toRootRelativePath("/", "/tmp/a.md"), "tmp/a.md");
});

test("toAbsolutePath はルートからの相対パスを絶対パスに戻す", () => {
  assert.equal(toAbsolutePath("/tmp/out", ""), "/tmp/out");
  assert.equal(toAbsolutePath("/tmp/out", "logs/run.log"), "/tmp/out/logs/run.log");
  assert.equal(toAbsolutePath("/", "tmp"), "/tmp");
});

test("splitDirectoryPath はディレクトリ名と親のパスに分ける", () => {
  assert.deepEqual(splitDirectoryPath("/tmp/some/directory"), {
    name: "directory",
    parent: "/tmp/some",
  });
  assert.deepEqual(splitDirectoryPath("/tmp"), { name: "tmp", parent: "/" });
});
