import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isErrnoException } from "../../../src/main/errors/utils.ts";

test("isErrnoException はファイル操作のエラーを認める", async () => {
  const missingPath = path.join(os.tmpdir(), "yuru-errno-missing", "file.txt");
  const error = await fs.promises.readFile(missingPath).catch((caught) => caught);

  assert.equal(isErrnoException(error), true);
  assert.equal(error.code, "ENOENT");
});

test("isErrnoException は終了コードを code に持つ子プロセスのエラーを認めない", async () => {
  const error = await new Promise((resolve) => {
    execFile(process.execPath, ["-e", "process.exit(3)"], (caught) => resolve(caught));
  });

  assert.equal(error.code, 3);
  assert.equal(isErrnoException(error), false);
});

test("isErrnoException は code の無いエラーと Error 以外を認めない", () => {
  assert.equal(isErrnoException(new Error("plain")), false);
  assert.equal(isErrnoException({ code: "ENOENT" }), false);
  assert.equal(isErrnoException(null), false);
  assert.equal(isErrnoException("ENOENT"), false);
});
