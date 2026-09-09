import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

// 動的 import で言語ごとに別チャンクへ分割し、編集中のファイルに必要な言語だけをロードする。
// 該当が無ければ null (ハイライト無しで編集)。
export function loadLanguageExtension(filePath: string): Promise<Extension> | null {
  const fileName = filePath.split("/").pop()?.toLowerCase();
  const ext = fileName?.startsWith("dockerfile.") ? "dockerfile" : fileName?.split(".").pop();
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
    // JSON5 は ES5 の値リテラルの部分集合 (コメント・引用符なしキー・シングルクォート・
    // 末尾カンマ) なので、それらを解釈できる JavaScript の JSON モードを使う。
    // @codemirror/lang-json は JSON5 固有の記法を構文エラーとして扱ってしまう。
    // tokenTable: このモードは引用符付きキーに "string property" を返すが、
    // StreamLanguage は複合スタイルを既定のタグ表で解決できないため対応付けを補う。
    case "json5":
      return Promise.all([
        import("@codemirror/legacy-modes/mode/javascript"),
        import("@lezer/highlight"),
      ]).then(([mode, { tags }]) =>
        StreamLanguage.define({ ...mode.json, tokenTable: { property: tags.propertyName } }),
      );
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
    // lang-cpp は C と C++ を同じ文法で扱う。C 固有の拡張子 (.c) と、C/C++ で共用の
    // ヘッダ (.h) もここに含める。
    case "c":
    case "cpp":
    case "cc":
    case "cxx":
    case "c++":
    case "h":
    case "hpp":
    case "hh":
    case "hxx":
    case "h++":
    case "inl":
    case "ipp":
    case "tpp":
    case "ixx":
    case "cppm":
      return import("@codemirror/lang-cpp").then((m) => m.cpp());
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
    case "dockerfile":
      return import("@codemirror/legacy-modes/mode/dockerfile").then((m) =>
        StreamLanguage.define(m.dockerFile),
      );
    case "proto":
      return import("@codemirror/legacy-modes/mode/protobuf").then((m) =>
        StreamLanguage.define(m.protobuf),
      );
    case "sql":
      return import("@codemirror/lang-sql").then((m) => m.sql());
    case "tf":
    case "tfvars":
      return import("codemirror-lang-hcl").then((m) => m.hcl());
    default:
      return null;
  }
}
