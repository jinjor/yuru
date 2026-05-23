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
