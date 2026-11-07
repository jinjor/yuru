import assert from "node:assert/strict";
import test from "node:test";

import { isExternalPath } from "../../../src/renderer/preview/previewSelection.ts";

test("isExternalPath は絶対パスを worktree の外とみなす", () => {
  assert.equal(isExternalPath("/tmp/out"), true);
  assert.equal(isExternalPath("src/app.ts"), false);
  assert.equal(isExternalPath(""), false);
});
