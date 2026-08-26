import assert from "node:assert/strict";
import test from "node:test";

import { isTestFile } from "../../src/shared/test-file.ts";

test("JavaScript / TypeScript の test・spec を判定する", () => {
  for (const extension of ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"]) {
    assert.equal(isTestFile(`src/app.test.${extension}`), true, extension);
    assert.equal(isTestFile(`src/app.spec.${extension}`), true, extension);
    assert.equal(isTestFile(`src/app.${extension}`), false, extension);
  }
});

test("Go の _test.go を判定する", () => {
  assert.equal(isTestFile("cmd/main_test.go"), true);
  assert.equal(isTestFile("cmd/main.go"), false);
});

test("Python の test_ 前置と _test 後置を判定する", () => {
  assert.equal(isTestFile("tests/test_client.py"), true);
  assert.equal(isTestFile("tests/client_test.py"), true);
  assert.equal(isTestFile("tests/client.py"), false);
});

test("名前の一部にたまたま test や spec を含むだけのファイルは判定しない", () => {
  assert.equal(isTestFile("src/latest.ts"), false);
  assert.equal(isTestFile("src/contest.go"), false);
  assert.equal(isTestFile("src/manifest.py"), false);
  assert.equal(isTestFile("src/testing.py"), false);
});

test("規約のない言語は判定しない", () => {
  assert.equal(isTestFile("tests/client.rs"), false);
  assert.equal(isTestFile("spec/client_spec.rb"), false);
});

test("ディレクトリ名は見ない", () => {
  assert.equal(isTestFile("test/helpers/factory.ts"), false);
  assert.equal(isTestFile("__tests__/app.ts"), false);
});
