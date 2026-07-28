import assert from "node:assert/strict";
import test from "node:test";

import { findTerminalLinks } from "../../../src/renderer/components/terminalLinks.ts";

test("findTerminalLinks は http/https URL を検出する", () => {
  assert.deepEqual(findTerminalLinks("Docs: https://example.com/docs?q=terminal#links"), [
    {
      kind: "url",
      text: "https://example.com/docs?q=terminal#links",
      startIndex: 6,
      url: "https://example.com/docs?q=terminal#links",
    },
  ]);
});

test("findTerminalLinks は URL の末尾に付いた文末記号を外す", () => {
  assert.deepEqual(findTerminalLinks("See (https://github.com/jinjor/yuru/pull/40)."), [
    {
      kind: "url",
      text: "https://github.com/jinjor/yuru/pull/40",
      startIndex: 5,
      url: "https://github.com/jinjor/yuru/pull/40",
    },
  ]);
});

test("findTerminalLinks は URL の内側を file link として重複検出しない", () => {
  assert.deepEqual(findTerminalLinks("open https://example.com/docs/readme.md and src/app.ts:12"), [
    {
      kind: "url",
      text: "https://example.com/docs/readme.md",
      startIndex: 5,
      url: "https://example.com/docs/readme.md",
    },
    {
      kind: "file",
      text: "src/app.ts:12",
      startIndex: 44,
      filePath: "src/app.ts",
      fileLine: 12,
    },
  ]);
});

test("findTerminalLinks は拡張子のない絶対パスを検出する", () => {
  assert.deepEqual(findTerminalLinks("open /tmp/mock and /tmp/Dockerfile"), [
    {
      kind: "file",
      text: "/tmp/mock",
      startIndex: 5,
      filePath: "/tmp/mock",
      fileLine: undefined,
    },
    {
      kind: "file",
      text: "/tmp/Dockerfile",
      startIndex: 19,
      filePath: "/tmp/Dockerfile",
      fileLine: undefined,
    },
  ]);
});

test("findTerminalLinks は + を含む拡張子を切り詰めない", () => {
  assert.deepEqual(findTerminalLinks("see /tmp/report.c++ and src/foo.c++"), [
    {
      kind: "file",
      text: "/tmp/report.c++",
      startIndex: 4,
      filePath: "/tmp/report.c++",
      fileLine: undefined,
    },
    {
      kind: "file",
      text: "src/foo.c++",
      startIndex: 24,
      filePath: "src/foo.c++",
      fileLine: undefined,
    },
  ]);
});

test("findTerminalLinks は絶対パスの行番号を解釈し、文末のピリオドを外す", () => {
  assert.deepEqual(findTerminalLinks("check /tmp/notes.md:7. done"), [
    {
      kind: "file",
      text: "/tmp/notes.md:7",
      startIndex: 6,
      filePath: "/tmp/notes.md",
      fileLine: 7,
    },
  ]);
  assert.deepEqual(findTerminalLinks("see /tmp/mock."), [
    {
      kind: "file",
      text: "/tmp/mock",
      startIndex: 4,
      filePath: "/tmp/mock",
      fileLine: undefined,
    },
  ]);
});

test("findTerminalLinks は分数や and/or のようなスラッシュ表記をリンクにしない", () => {
  assert.deepEqual(findTerminalLinks("10/12 done, true/false, and/or"), []);
});
