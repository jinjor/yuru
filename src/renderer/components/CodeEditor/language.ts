import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

// 動的 import で言語ごとに別チャンクへ分割し、編集中のファイルに必要な言語だけをロードする。
// 該当が無ければ null (ハイライト無しで編集)。
export function loadLanguageExtension(filePath: string): Promise<Extension> | null {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true }));
    case "tsx":
      return import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ typescript: true, jsx: true }),
      );
    case "js":
    case "mjs":
    case "cjs":
      return import("@codemirror/lang-javascript").then((m) => m.javascript());
    case "jsx":
      return import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true }));
    case "json":
      return import("@codemirror/lang-json").then((m) => m.json());
    case "html":
    case "htm":
      return import("@codemirror/lang-html").then((m) => m.html());
    case "css":
      return import("@codemirror/lang-css").then((m) => m.css());
    case "md":
    case "markdown":
      return import("@codemirror/lang-markdown").then((m) => m.markdown());
    case "yaml":
    case "yml":
      return import("@codemirror/lang-yaml").then((m) => m.yaml());
    case "py":
      return import("@codemirror/lang-python").then((m) => m.python());
    case "rs":
      return import("@codemirror/lang-rust").then((m) => m.rust());
    case "go":
      return import("@codemirror/lang-go").then((m) => m.go());
    case "sh":
    case "bash":
    case "zsh":
      return import("@codemirror/legacy-modes/mode/shell").then((m) =>
        StreamLanguage.define(m.shell),
      );
    case "toml":
      return import("@codemirror/legacy-modes/mode/toml").then((m) =>
        StreamLanguage.define(m.toml),
      );
    default:
      return null;
  }
}
