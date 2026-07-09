import assert from "node:assert/strict";
import test from "node:test";

const { TerminalScreen } = await import("../../src/main/terminal-screen.ts");
const { Terminal } = (await import("@xterm/headless")).default;

const COLS = 40;
const ROWS = 10;

function bufferLines(terminal) {
  const buffer = terminal.buffer.active;
  const lines = [];
  for (let i = 0; i < buffer.length; i++) {
    lines.push(buffer.getLine(i).translateToString(true));
  }
  return lines;
}

function writeAll(terminal, data) {
  return new Promise((resolve) => {
    terminal.write(data, resolve);
  });
}

// serialize の結果を同じサイズの端末に書き込み、画面が一致することを確認する。
async function assertRoundTrip(chunks) {
  const screen = new TerminalScreen(COLS, ROWS);
  const source = new Terminal({ cols: COLS, rows: ROWS });
  for (const chunk of chunks) {
    screen.write(chunk);
  }
  await writeAll(source, chunks.join(""));

  const restored = new Terminal({ cols: COLS, rows: ROWS });
  await writeAll(restored, await screen.serialize());

  assert.deepEqual(bufferLines(restored), bufferLines(source));
  assert.equal(restored.buffer.active.cursorX, source.buffer.active.cursorX);
  assert.equal(restored.buffer.active.cursorY, source.buffer.active.cursorY);

  screen.dispose();
  source.dispose();
  restored.dispose();
}

test("serialize restores plain output and cursor position", async () => {
  await assertRoundTrip(["one\r\ntwo\r\n", "\x1b[31mred\x1b[0m\r\n", "prompt> "]);
});

test("serialize restores a TUI-style repaint mid-frame", async () => {
  const chunks = ["header\r\nline a\r\nline b\r\nstatus"];
  for (let i = 0; i < 50; i++) {
    // synchronized update で 3 行を書き直す agent TUI 風のフレーム
    chunks.push(`\x1b[?2026h\x1b[2A\r\x1b[0Jline a ${i}\r\nline b ${i}\r\nstatus ${i}\x1b[?2026l`);
  }
  await assertRoundTrip(chunks);
});

test("serialize restores output that scrolled into scrollback", async () => {
  const chunks = [];
  for (let i = 0; i < ROWS * 3; i++) {
    chunks.push(`line ${i}\r\n`);
  }
  await assertRoundTrip(chunks);
});

test("serialize includes writes issued immediately before it", async () => {
  const screen = new TerminalScreen(COLS, ROWS);
  for (let i = 0; i < 1000; i++) {
    screen.write(`chunk ${i} `);
  }
  screen.write("END");
  const serialized = await screen.serialize();

  const restored = new Terminal({ cols: COLS, rows: ROWS });
  await writeAll(restored, serialized);
  const lines = bufferLines(restored).join("\n");
  assert.ok(lines.includes("chunk 999 END"), lines.slice(-200));

  screen.dispose();
  restored.dispose();
});
