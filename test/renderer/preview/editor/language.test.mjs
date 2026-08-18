import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { classHighlighter, highlightTree } from "@lezer/highlight";

import { loadLanguageExtension } from "../../../../src/renderer/preview/editor/language.ts";

test("Dockerfile の編集時に命令をハイライトする", async () => {
  const paths = [
    "Dockerfile",
    "docker/Dockerfile",
    "docker/Dockerfile.dev",
    "docker/service.dockerfile",
  ];

  for (const path of paths) {
    const language = loadLanguageExtension(path);
    assert.ok(language, path);

    const state = EditorState.create({
      doc: "FROM node:24",
      extensions: [await language],
    });
    const highlighted = [];
    highlightTree(syntaxTree(state), classHighlighter, (from, to, classes) => {
      highlighted.push({ text: state.sliceDoc(from, to), classes });
    });

    assert.deepEqual(highlighted, [{ text: "FROM", classes: "tok-keyword" }], path);
  }
});

test(".proto の編集時にキーワードをハイライトする", async () => {
  const language = loadLanguageExtension("api/service.proto");
  assert.ok(language);

  const state = EditorState.create({
    doc: "message Foo {}",
    extensions: [await language],
  });
  const highlighted = [];
  highlightTree(syntaxTree(state), classHighlighter, (from, to, classes) => {
    highlighted.push({ text: state.sliceDoc(from, to), classes });
  });

  assert.deepEqual(highlighted, [
    { text: "message", classes: "tok-keyword" },
    { text: "Foo", classes: "tok-variableName" },
  ]);
});

test(".sql の編集時にキーワードをハイライトする", async () => {
  const language = loadLanguageExtension("db/schema.sql");
  assert.ok(language);

  const state = EditorState.create({
    doc: "SELECT 1",
    extensions: [await language],
  });
  const highlighted = [];
  highlightTree(syntaxTree(state), classHighlighter, (from, to, classes) => {
    highlighted.push({ text: state.sliceDoc(from, to), classes });
  });

  assert.deepEqual(highlighted, [
    { text: "SELECT", classes: "tok-keyword" },
    { text: "1", classes: "tok-number" },
  ]);
});

test(".tf / .tfvars の編集時にハイライトする", async () => {
  const tf = loadLanguageExtension("infra/main.tf");
  assert.ok(tf);

  const tfState = EditorState.create({
    doc: 'variable "name" {}',
    extensions: [await tf],
  });
  const tfHighlighted = [];
  highlightTree(syntaxTree(tfState), classHighlighter, (from, to, classes) => {
    tfHighlighted.push({ text: tfState.sliceDoc(from, to), classes });
  });

  assert.deepEqual(tfHighlighted.slice(0, 2), [
    { text: "variable", classes: "tok-keyword" },
    { text: '"', classes: "tok-string" },
  ]);

  const tfvars = loadLanguageExtension("infra/prod.tfvars");
  assert.ok(tfvars);

  const tfvarsState = EditorState.create({
    doc: 'region = "us-east-1"',
    extensions: [await tfvars],
  });
  const tfvarsHighlighted = [];
  highlightTree(syntaxTree(tfvarsState), classHighlighter, (from, to, classes) => {
    tfvarsHighlighted.push({ text: tfvarsState.sliceDoc(from, to), classes });
  });

  assert.deepEqual(tfvarsHighlighted[0], {
    text: "region",
    classes: "tok-propertyName tok-definition",
  });
});
