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
    this.terminal = new Terminal({ cols, rows });
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

  // write() は内部キューで非同期に処理されるため、空 write のコールバックで
  // 「ここまでの write が反映済み」になるのを待ってから serialize する。
  // serialize はコールバック内で同期的に行う。これにより、このメソッド呼び出し以前に
  // 届いたデータは必ずスナップショットに含まれ、以後に届いたデータは決して含まれない。
  serialize(): Promise<string> {
    return new Promise((resolve) => {
      this.terminal.write("", () => {
        resolve(this.serializeAddon.serialize());
      });
    });
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
