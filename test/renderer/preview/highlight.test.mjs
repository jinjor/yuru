import assert from "node:assert/strict";
import test from "node:test";

import { tokenizeCode } from "../../../src/renderer/preview/highlight.ts";

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

test(".proto を拡張子で判定してハイライトする", async () => {
  const [line] = await tokenizeCode("message Foo {}", "api/service.proto", 14);
  assert.equal(line.tokens[0]?.content, "message");
  assert.notEqual(line.tokens[0]?.color, "#d4d4d4");
});

test(".sql を拡張子で判定してハイライトする", async () => {
  const [line] = await tokenizeCode("SELECT 1", "db/schema.sql", 8);
  assert.equal(line.tokens[0]?.content, "SELECT");
  assert.notEqual(line.tokens[0]?.color, "#d4d4d4");
});

test(".tf を拡張子で判定してハイライトする", async () => {
  const [line] = await tokenizeCode('variable "name" {}', "infra/main.tf", 18);
  assert.equal(line.tokens[0]?.content, "variable");
  assert.notEqual(line.tokens[0]?.color, "#d4d4d4");
});

test(".tfvars を拡張子で判定してハイライトする", async () => {
  const [line] = await tokenizeCode('region = "us-east-1"', "infra/prod.tfvars", 20);
  assert.equal(line.tokens[0]?.content, "region ");
  assert.notEqual(line.tokens[0]?.color, "#d4d4d4");
});
