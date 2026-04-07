import { createHighlighter, type Highlighter, type ThemedToken } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

const defaultLangs = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "html",
  "css",
  "markdown",
  "yaml",
  "toml",
  "bash",
  "python",
  "rust",
  "go",
];

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["dark-plus"],
      langs: defaultLangs,
    });
  }
  return highlighterPromise;
}

const extensionToLang: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  mts: "typescript",
  json: "json",
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
};

function detectLanguage(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase();
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

    const result = highlighter.codeToTokens(code, {
      lang,
      theme: "dark-plus",
    });

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
