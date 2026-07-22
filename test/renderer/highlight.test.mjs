import assert from "node:assert/strict";
import test from "node:test";

import { tokenizeCode } from "../../src/renderer/highlight.ts";

test("Dockerfile をファイル名で判定してハイライトする", async () => {
  const paths = [
    "Dockerfile",
    "docker/Dockerfile",
    "docker/Dockerfile.dev",
    "docker/service.dockerfile",
  ];

  for (const path of paths) {
    const [line] = await tokenizeCode("FROM node:24", path, 12);
    assert.equal(line.tokens[0]?.content, "FROM", path);
    assert.notEqual(line.tokens[0]?.color, "#d4d4d4", path);
  }
});
