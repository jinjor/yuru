import assert from "node:assert/strict";
import test from "node:test";

import { findTerminalLinks } from "../../../src/renderer/terminal/terminalLinks.ts";

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

test("findTerminalLinks は chrome:// URL を検出する", () => {
  assert.deepEqual(findTerminalLinks("Help: chrome://settings/help"), [
    {
      kind: "url",
      text: "chrome://settings/help",
      startIndex: 6,
      url: "chrome://settings/help",
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

test("findTerminalLinks は URL の内側をパスのリンクとして重複検出しない", () => {
  assert.deepEqual(findTerminalLinks("open https://example.com/docs/readme.md and src/app.ts:12"), [
    {
      kind: "url",
      text: "https://example.com/docs/readme.md",
      startIndex: 5,
      url: "https://example.com/docs/readme.md",
    },
    {
      kind: "path",
      text: "src/app.ts:12",
      startIndex: 44,
      path: "src/app.ts",
      line: 12,
    },
  ]);
});

test("findTerminalLinks は #番号を現在の GitHub repository の Issue / PR URL にする", () => {
  assert.deepEqual(findTerminalLinks("Fixes #75.", "jinjor/yuru"), [
    {
      kind: "url",
      text: "#75",
      startIndex: 6,
      url: "https://github.com/jinjor/yuru/pull/75",
    },
  ]);
});

test("findTerminalLinks は owner/repository#番号を外部 GitHub repository の URL にする", () => {
  assert.deepEqual(findTerminalLinks("See cli/cli#1000 and #76", "jinjor/yuru"), [
    {
      kind: "url",
      text: "cli/cli#1000",
      startIndex: 4,
      url: "https://github.com/cli/cli/pull/1000",
    },
    {
      kind: "url",
      text: "#76",
      startIndex: 21,
      url: "https://github.com/jinjor/yuru/pull/76",
    },
  ]);
});

test("findTerminalLinks は GitHub repository が不明なら裸の #番号をリンクにしない", () => {
  assert.deepEqual(findTerminalLinks("See #75 and repo#76 and #77abc"), []);
  assert.deepEqual(findTerminalLinks("See owner/repo#75"), [
    {
      kind: "url",
      text: "owner/repo#75",
      startIndex: 4,
      url: "https://github.com/owner/repo/pull/75",
    },
  ]);
});

test("findTerminalLinks は拡張子のない絶対パスを検出する", () => {
  assert.deepEqual(findTerminalLinks("open /tmp/mock and /tmp/Dockerfile"), [
    {
      kind: "path",
      text: "/tmp/mock",
      startIndex: 5,
      path: "/tmp/mock",
      line: undefined,
    },
    {
      kind: "path",
      text: "/tmp/Dockerfile",
      startIndex: 19,
      path: "/tmp/Dockerfile",
      line: undefined,
    },
  ]);
});

test("findTerminalLinks は + を含む拡張子を切り詰めない", () => {
  assert.deepEqual(findTerminalLinks("see /tmp/report.c++ and src/foo.c++"), [
    {
      kind: "path",
      text: "/tmp/report.c++",
      startIndex: 4,
      path: "/tmp/report.c++",
      line: undefined,
    },
    {
      kind: "path",
      text: "src/foo.c++",
      startIndex: 24,
      path: "src/foo.c++",
      line: undefined,
    },
  ]);
});

test("findTerminalLinks は絶対パスの行番号を解釈し、文末のピリオドを外す", () => {
  assert.deepEqual(findTerminalLinks("check /tmp/notes.md:7. done"), [
    {
      kind: "path",
      text: "/tmp/notes.md:7",
      startIndex: 6,
      path: "/tmp/notes.md",
      line: 7,
    },
  ]);
  assert.deepEqual(findTerminalLinks("see /tmp/mock."), [
    {
      kind: "path",
      text: "/tmp/mock",
      startIndex: 4,
      path: "/tmp/mock",
      line: undefined,
    },
  ]);
});

test("findTerminalLinks は分数や and/or のようなスラッシュ表記をリンクにしない", () => {
  assert.deepEqual(findTerminalLinks("10/12 done, true/false, and/or"), []);
});

test("findTerminalLinks は拡張子も ./ も末尾の / もない相対パスをリンクにしない", () => {
  // 途中の `/renderer/terminal` を絶対パスとして拾わないことも確かめる。
  assert.deepEqual(findTerminalLinks("see src/renderer and src/renderer/terminal"), []);
});

test("findTerminalLinks は 1 階層の絶対パスや / だけの表記をリンクにしない", () => {
  assert.deepEqual(findTerminalLinks("/tmp and /12, a / b // c"), []);
});

test("findTerminalLinks は ./ や ../ で始まる相対パスを拡張子がなくても検出する", () => {
  assert.deepEqual(findTerminalLinks("run ./bin/yuru or ../tmp/mock."), [
    {
      kind: "path",
      text: "./bin/yuru",
      startIndex: 4,
      path: "./bin/yuru",
      line: undefined,
    },
    {
      kind: "path",
      text: "../tmp/mock",
      startIndex: 18,
      path: "../tmp/mock",
      line: undefined,
    },
  ]);
});

test("findTerminalLinks は末尾に / があるパスを末尾の / ごと検出する", () => {
  assert.deepEqual(findTerminalLinks("see docs/, src/renderer/terminal/ and /tmp/out/."), [
    {
      kind: "path",
      text: "docs/",
      startIndex: 4,
      path: "docs/",
      line: undefined,
    },
    {
      kind: "path",
      text: "src/renderer/terminal/",
      startIndex: 11,
      path: "src/renderer/terminal/",
      line: undefined,
    },
    {
      kind: "path",
      text: "/tmp/out/",
      startIndex: 38,
      path: "/tmp/out/",
      line: undefined,
    },
  ]);
});

test("findTerminalLinks は他のリンクと重なる部分をパスのリンクにしない", () => {
  assert.deepEqual(
    findTerminalLinks("/tmp/mock https://example.com/a/b/ src/app.ts owner/repo#1 docs/").map(
      (link) => [link.kind, link.text],
    ),
    [
      ["path", "/tmp/mock"],
      ["url", "https://example.com/a/b/"],
      ["path", "src/app.ts"],
      ["url", "owner/repo#1"],
      ["path", "docs/"],
    ],
  );
});
