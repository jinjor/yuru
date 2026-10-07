import * as serializeModule from "@xterm/addon-serialize";
import * as headlessModule from "@xterm/headless";

// どちらも exports マップの無い CommonJS バンドル。CJS にコンパイルされる本体では
// namespace import がモジュールそのものになり、ESM として読むユニットテストでは
// default にモジュールが入る (Node の CJS interop)。その差をここで吸収する。
function resolveCjsModule<T>(module: T): T {
  return (module as { default?: T }).default ?? module;
}

const { Terminal } = resolveCjsModule(headlessModule);
const { SerializeAddon } = resolveCjsModule(serializeModule);
type Terminal = InstanceType<typeof Terminal>;
type SerializeAddon = InstanceType<typeof SerializeAddon>;

// PTY の出力を main process 側でも端末として解釈し、画面とスクロールバックの状態を保持する。
// renderer が attach し直す時は serialize() の結果を書き込めば表示を復元できる。
// 生の出力ストリームを溜めて再生する方式は、容量制限で先頭を切り落とした時に
// エスケープシーケンスや TUI の再描画フレームの途中から再生されて表示が壊れる。
export class TerminalScreen {
  private readonly terminal: Terminal;
  private readonly serializeAddon: SerializeAddon;
  private title = "";

  constructor(cols: number, rows: number) {
    this.terminal = new Terminal({ cols, rows, scrollback: 4000 });
    this.serializeAddon = new SerializeAddon();
    this.terminal.loadAddon(this.serializeAddon);
    this.terminal.onTitleChange((title) => {
      this.title = title;
    });
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  getTitle(): string {
    return this.title;
  }

  // Only the current screen, joining soft-wrapped rows without scrollback.
  getVisibleText(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < this.terminal.rows; row += 1) {
      const line = buffer.getLine(buffer.baseY + row);
      const text = line?.translateToString(false) ?? "";
      if (line?.isWrapped && lines.length > 0) {
        lines[lines.length - 1] += text;
      } else {
        lines.push(text);
      }
    }
    return lines.map((line) => line.trimEnd()).join("\n");
  }

  // write() は内部キューで非同期に処理されるため、write のコールバックで
  // 「ここまでの write が反映済み」になるのを待ってから serialize する。
  // serialize はコールバック内で同期的に行う。これにより、このメソッド呼び出し以前に
  // 届いたデータは必ずスナップショットに含まれ、以後に届いたデータは決して含まれない。
  serialize(): Promise<string> {
    return new Promise((resolve) => {
      // addon-serialize はマウスの送信形式を保存しない。端末自身に現在の形式を
      // 問い合わせて補い、復元後も TUI が要求した形式でマウス入力を送る。
      const mouseModes = new Map([
        [1006, false],
        [1016, false],
      ]);
      const listener = this.terminal.onData((data) => {
        const report = data.startsWith("\x1b[?")
          ? /^(1006|1016);([12])\$y$/.exec(data.slice(3))
          : null;
        if (report) {
          mouseModes.set(Number(report[1]), report[2] === "1");
        }
      });
      this.terminal.write("\x1b[?1006$p\x1b[?1016$p", () => {
        listener.dispose();
        const mouseEncoding = [...mouseModes]
          .filter(([, enabled]) => enabled)
          .map(([mode]) => `\x1b[?${mode}h`)
          .join("");
        resolve(this.serializeAddon.serialize() + mouseEncoding);
      });
    });
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
