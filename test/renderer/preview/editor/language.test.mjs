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
