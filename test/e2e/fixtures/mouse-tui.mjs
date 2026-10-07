// Codex と同じマウス入力を要求し、PTY に届いた入力で選択・スクロールの表示を更新する。
// legacy モードでは 0x80 以上の座標バイトもそのまま受信できることを確認する。
const encoding = process.argv[2];
let pending = Buffer.alloc(0);
let drags = 0;
let scrolls = 0;
let lastColumn = 0;

function render() {
  process.stdout.write(
    `\x1b[H\x1b[2K${drags ? "\x1b[7m" : ""}MOUSE_TARGET\x1b[0m` +
      `\x1b[2;1H\x1b[2KDRAGS_${drags}_COL_${lastColumn}` +
      `\x1b[3;1H\x1b[2KSCROLLS_${scrolls}`,
  );
}

function mouse(code, column) {
  if (code === 32) {
    drags++;
    lastColumn = column;
    render();
  } else if (code === 64 || code === 65) {
    scrolls++;
    render();
  }
}

process.stdin.setRawMode(true);
process.stdin.on("data", (data) => {
  pending = Buffer.concat([pending, data]);
  while (pending.length > 0) {
    if (pending[0] === 3) {
      process.stdout.write("\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l\x1b[?1049l");
      process.stdin.setRawMode(false);
      process.exit(0);
    }
    if (pending[0] !== 27) {
      pending = pending.subarray(1);
      continue;
    }
    if (pending.length < 3) break;
    if (pending[1] === 91 && pending[2] === 77) {
      if (pending.length < 6) break;
      mouse(pending[3] - 32, pending[4] - 32);
      pending = pending.subarray(6);
    } else if (pending[1] === 91 && pending[2] === 60) {
      const report = /^\x1b\[<(\d+);(\d+);(\d+)[Mm]/.exec(pending.toString("ascii"));
      if (!report) break;
      mouse(Number(report[1]), Number(report[2]));
      pending = pending.subarray(report[0].length);
    } else {
      pending = pending.subarray(1);
    }
  }
});
process.stdout.write(
  "\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h" +
    (encoding === "sgr" ? "\x1b[?1006h" : "\x1b[?1006l") +
    "\x1b[2J",
);
render();
