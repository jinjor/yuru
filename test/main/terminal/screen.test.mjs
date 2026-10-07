import assert from "node:assert/strict";
import test from "node:test";

const { TerminalScreen } = await import("../../../src/main/terminal/screen.ts");
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

async function mouseModeReports(terminal) {
  const reports = [];
  const listener = terminal.onData((data) => reports.push(data));
  await writeAll(terminal, "\x1b[?1003$p\x1b[?1006$p\x1b[?1016$p");
  listener.dispose();
  return reports;
}

test("serialize preserves mouse tracking and encoding after mode changes and reset", async () => {
  const screen = new TerminalScreen(COLS, ROWS);
  const source = new Terminal({ cols: COLS, rows: ROWS });
  try {
    for (const modes of [
      "\x1b[?1049h\x1b[?1003h\x1b[?1006h",
      "\x1b[?1016h",
      "\x1b[?1016l",
      "\x1b[?1006h",
      "\x1bc",
    ]) {
      // Split escape sequences across writes, as real PTY chunks can be split.
      for (const char of modes) screen.write(char);
      await writeAll(source, modes);
      const restored = new Terminal({ cols: COLS, rows: ROWS });
      try {
        await writeAll(restored, await screen.serialize());
        assert.deepEqual(await mouseModeReports(restored), await mouseModeReports(source));
      } finally {
        restored.dispose();
      }
    }
  } finally {
    screen.dispose();
    source.dispose();
  }
});

test("simultaneous snapshots query the mouse encoding without changing the screen", async () => {
  const screen = new TerminalScreen(COLS, ROWS);
  try {
    screen.write("mouse screen\x1b[?1003h\x1b[?1006h");
    const snapshots = await Promise.all([screen.serialize(), screen.serialize()]);
    assert.equal(snapshots[0], snapshots[1]);
    assert.equal(screen.getVisibleText().trimEnd(), "mouse screen");
    assert.ok(snapshots[0].includes("\x1b[?1006h"));
  } finally {
    screen.dispose();
  }
});

test("tracks the latest OSC terminal title", async () => {
  const screen = new TerminalScreen(COLS, ROWS);
  screen.write("\x1b]0;codex-permission-dot\x07");
  screen.write("\x1b]0;[ ! ] Action Required | codex-permission-dot\x07");
  await screen.serialize();

  assert.equal(screen.getTitle(), "[ ! ] Action Required | codex-permission-dot");

  screen.dispose();
});

test("visible text reflects repaints and excludes scrollback", async () => {
  const screen = new TerminalScreen(COLS, ROWS);
  screen.write("old picker footer\r\n");
  for (let row = 0; row < ROWS; row += 1) {
    screen.write(`working ${row}\r\n`);
  }
  await screen.serialize();
  assert.ok(!screen.getVisibleText().includes("old picker footer"));
  assert.ok(screen.getVisibleText().includes("working 9"));

  screen.write("\x1b[H\x1b[2J❭ 1 Yes\r\n  2 No\r\n↑↓ select · ↵ confirm · esc cancel");
  await screen.serialize();
  assert.equal(
    screen.getVisibleText().trimEnd(),
    "❭ 1 Yes\n  2 No\n↑↓ select · ↵ confirm · esc cancel",
  );
  screen.dispose();
});

test("visible text joins picker footers wrapped in a narrow terminal", async () => {
  const screen = new TerminalScreen(COLS, ROWS);
  const footer = "↑↓ select · ←→ reasoning effort · ↵ confirm · esc cancel";
  screen.write(`❭ SWE-2 High\r\n${footer}`);
  await screen.serialize();
  assert.equal(screen.getVisibleText().trimEnd(), `❭ SWE-2 High\n${footer}`);
  screen.dispose();
});
