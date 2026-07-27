import assert from "node:assert/strict";
import test from "node:test";

const { Terminal } = (await import("@xterm/headless")).default;
const { findTerminalLinksInBufferLine } =
  await import("../../../src/renderer/components/terminalBufferLinks.ts");

function writeAll(terminal, data) {
  return new Promise((resolve) => {
    terminal.write(data, resolve);
  });
}

test("findTerminalLinksInBufferLine は自動折り返しを跨ぐ file link を検出する", async () => {
  const terminal = new Terminal({ cols: 12, rows: 6 });
  await writeAll(terminal, "open src/very/long/file.ts:12");

  const expected = [
    {
      kind: "file",
      text: "src/very/long/file.ts:12",
      startIndex: 5,
      filePath: "src/very/long/file.ts",
      fileLine: 12,
      range: {
        start: { x: 6, y: 1 },
        end: { x: 5, y: 3 },
      },
    },
  ];
  for (const bufferLineNumber of [1, 2, 3]) {
    assert.deepEqual(
      findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, bufferLineNumber),
      expected,
    );
  }
  assert.deepEqual(findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, 4), []);

  terminal.dispose();
});

test("findTerminalLinksInBufferLine は全角文字のセル幅を考慮する", async () => {
  const terminal = new Terminal({ cols: 12, rows: 4 });
  await writeAll(terminal, "日本 src/file.ts");

  const expectedRange = {
    start: { x: 6, y: 1 },
    end: { x: 4, y: 2 },
  };
  for (const bufferLineNumber of [1, 2]) {
    assert.deepEqual(
      findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, bufferLineNumber)[0]
        ?.range,
      expectedRange,
    );
  }

  terminal.dispose();
});

test("findTerminalLinksInBufferLine は TUI が複数行に描画した file link を各行で検出する", async () => {
  const terminal = new Terminal({ cols: 17, rows: 5 });
  await writeAll(terminal, "open src/rendere\r\n  r/components/Te\r\n  rminal.tsx:12");

  const expectedLink = {
    kind: "file",
    text: "src/renderer/components/Terminal.tsx:12",
    startIndex: 0,
    filePath: "src/renderer/components/Terminal.tsx",
    fileLine: 12,
  };
  assert.deepEqual(findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, 1), [
    {
      ...expectedLink,
      range: {
        start: { x: 6, y: 1 },
        end: { x: 16, y: 1 },
      },
    },
  ]);
  assert.deepEqual(findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, 2), [
    {
      ...expectedLink,
      range: {
        start: { x: 3, y: 2 },
        end: { x: 17, y: 2 },
      },
    },
  ]);
  assert.deepEqual(findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, 3), [
    {
      ...expectedLink,
      range: {
        start: { x: 3, y: 3 },
        end: { x: 15, y: 3 },
      },
    },
  ]);

  terminal.dispose();
});

test("findTerminalLinksInBufferLine は右端より前で改行された TUI の file link を検出する", async () => {
  const terminal = new Terminal({ cols: 40, rows: 4 });
  await writeAll(terminal, "open src/components/very-long-\r\n  terminal-link-target.ts");

  for (const bufferLineNumber of [1, 2]) {
    assert.equal(
      findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, bufferLineNumber)[0]
        ?.filePath,
      "src/components/very-long-terminal-link-target.ts",
    );
  }

  terminal.dispose();
});

test("findTerminalLinksInBufferLine は拡張子の途中で改行された file link を検出する", async () => {
  const terminal = new Terminal({ cols: 16, rows: 4 });
  await writeAll(terminal, "open src/foo.ts\r\n  x");

  for (const bufferLineNumber of [1, 2]) {
    assert.equal(
      findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, bufferLineNumber)[0]
        ?.filePath,
      "src/foo.tsx",
    );
  }

  terminal.dispose();
});

test("findTerminalLinksInBufferLine はディレクトリを持たない長い file link を検出する", async () => {
  const terminal = new Terminal({ cols: 17, rows: 4 });
  await writeAll(terminal, "open aaaaaaaaaaa\r\n  aaaaa.ts");

  for (const bufferLineNumber of [1, 2]) {
    assert.equal(
      findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, bufferLineNumber)[0]
        ?.filePath,
      "aaaaaaaaaaaaaaaa.ts",
    );
  }

  terminal.dispose();
});

test("findTerminalLinksInBufferLine は短い隣接行を file link に結合しない", async () => {
  const terminal = new Terminal({ cols: 20, rows: 4 });
  await writeAll(terminal, "docs/\r\npackage.json");

  assert.deepEqual(findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, 1), []);
  assert.equal(
    findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, 2)[0]?.filePath,
    "package.json",
  );

  terminal.dispose();
});

test("findTerminalLinksInBufferLine は右端で終わる行をインデントのない次行に結合しない", async () => {
  const terminal = new Terminal({ cols: 16, rows: 4 });
  await writeAll(terminal, "prefixxxx docs/\r\npackage.json");

  assert.deepEqual(findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, 1), []);
  assert.equal(
    findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, 2)[0]?.filePath,
    "package.json",
  );

  terminal.dispose();
});

test("findTerminalLinksInBufferLine は別々の file link が続く行を結合しない", async () => {
  const terminal = new Terminal({ cols: 20, rows: 4 });
  await writeAll(terminal, "prefixxxx src/one.ts\r\n  src/two.ts");

  assert.equal(
    findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, 1)[0]?.filePath,
    "src/one.ts",
  );
  assert.equal(
    findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, 2)[0]?.filePath,
    "src/two.ts",
  );

  terminal.dispose();
});

test("findTerminalLinksInBufferLine は直前の単語を file link に結合しない", async () => {
  const terminal = new Terminal({ cols: 20, rows: 4 });
  await writeAll(terminal, "  explanation\r\n  src/file.ts");

  assert.deepEqual(findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, 1), []);
  assert.equal(
    findTerminalLinksInBufferLine(terminal.buffer.active, terminal.cols, 2)[0]?.filePath,
    "src/file.ts",
  );

  terminal.dispose();
});
