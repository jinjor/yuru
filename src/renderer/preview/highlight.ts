import type { BundledLanguage, Highlighter, ThemedToken } from "shiki";

const theme = "dark-plus";

let highlighterPromise: Promise<Highlighter> | null = null;

const defaultLangs: BundledLanguage[] = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "json5",
  "html",
  "css",
  "markdown",
  "yaml",
  "toml",
  "bash",
  "python",
  "rust",
  "go",
  "c",
  "cpp",
  "cmake",
  "dockerfile",
  "proto",
  "sql",
  "terraform",
  "diff",
];

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({
        themes: [theme],
        langs: defaultLangs,
      }),
    );
  }
  return highlighterPromise;
}

const extensionToLang: Record<string, BundledLanguage> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  mts: "typescript",
  json: "json",
  json5: "json5",
  html: "html",
  htm: "html",
  css: "css",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  rs: "rust",
  go: "go",
  // C/C++ で共用のヘッダ (.h) と C++ 系はまとめて cpp に寄せる。C 固有の .c だけ c。
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  "c++": "cpp",
  h: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  "h++": "cpp",
  inl: "cpp",
  ipp: "cpp",
  tpp: "cpp",
  ixx: "cpp",
  cppm: "cpp",
  cmake: "cmake",
  dockerfile: "dockerfile",
  proto: "proto",
  sql: "sql",
  tf: "terraform",
  tfvars: "terraform",
};

function detectLanguage(filePath: string): BundledLanguage | null {
  const fileName = filePath.split("/").pop()?.toLowerCase();
  if (fileName?.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  // CMake のトップレベルは常にこの固定ファイル名で、拡張子は .txt。名前で判定する。
  if (fileName === "cmakelists.txt") {
    return "cmake";
  }

  const ext = fileName?.split(".").pop();
  if (!ext) {
    return null;
  }
  return extensionToLang[ext] ?? null;
}

export interface TokenizedLine {
  tokens: ThemedToken[];
}

export async function tokenizeCode(
  code: string,
  filePath: string | null,
  fileSize: number | null,
): Promise<TokenizedLine[]> {
  if (!filePath || (fileSize ?? 0) > 250_000) {
    return plainTokenize(code);
  }

  const lang = detectLanguage(filePath);
  if (!lang) {
    return plainTokenize(code);
  }

  try {
    const highlighter = await getHighlighter();
    const loadedLangs = highlighter.getLoadedLanguages();
    if (!loadedLangs.includes(lang)) {
      try {
        await highlighter.loadLanguage(lang as Parameters<Highlighter["loadLanguage"]>[0]);
      } catch {
        return plainTokenize(code);
      }
    }

    const result = highlighter.codeToTokens(code, { lang, theme });

    return result.tokens.map((lineTokens) => ({ tokens: lineTokens }));
  } catch {
    return plainTokenize(code);
  }
}

function plainTokenize(code: string): TokenizedLine[] {
  return code.split("\n").map((line) => ({
    tokens: [{ content: line, color: "#d4d4d4", offset: 0 }],
  }));
}

// Markdown のコードフェンスをハイライトする。言語は ```lang に書かれた名前をそのまま受け取り、
// highlighter が読み込んでいるものだけを扱う。言語指定が無い・対応していない場合は null を返す
// ので、呼び出し側は色を付けずにそのまま出す。
export function tokenizeFence(
  highlighter: Highlighter,
  code: string,
  lang: string,
): ThemedToken[][] | null {
  const id = lang.toLowerCase();
  if (!highlighter.getLoadedLanguages().includes(id)) {
    return null;
  }
  // 読み込み済みであることを確かめた後なので、shiki の言語名として渡してよい。
  return highlighter.codeToTokens(code, { lang: id as BundledLanguage, theme }).tokens;
}
