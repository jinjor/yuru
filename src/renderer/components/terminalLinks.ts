export type TerminalLink =
  | {
      kind: "file";
      text: string;
      startIndex: number;
      filePath: string;
      fileLine?: number;
    }
  | {
      kind: "url";
      text: string;
      startIndex: number;
      url: string;
    };

// 絶対パスは拡張子がなくても拾う (worktree 外も含め、任意の種類のファイルを開くため)。
// 誤検出を減らすため 2 セグメント以上 (`/tmp/mock`) を要求し、`/12` のような分数表記は拾わない。
// 相対パスは従来通り拡張子ありのみ。拡張子は `c++` のように + を含みうる。
const filePathPattern =
  /(?:\/(?:[\w.+-]+\/)+[\w.+-]+|[\w./-][\w./-]*\.[\w+-]+)(?::(\d+)(?::\d+)?)?/g;
const urlPattern = /\bhttps?:\/\/[^\s<>"'`]+/g;

export function findTerminalLinks(lineText: string): TerminalLink[] {
  const urlLinks = findUrlLinks(lineText);
  const fileLinks = findFileLinks(lineText, urlLinks);
  return [...urlLinks, ...fileLinks].sort((a, b) => a.startIndex - b.startIndex);
}

function findUrlLinks(lineText: string): TerminalLink[] {
  const links: TerminalLink[] = [];
  let match: RegExpExecArray | null;

  urlPattern.lastIndex = 0;
  while ((match = urlPattern.exec(lineText)) !== null) {
    const text = trimTrailingUrlPunctuation(match[0]);
    if (!isHttpUrl(text)) {
      continue;
    }

    links.push({
      kind: "url",
      text,
      startIndex: match.index,
      url: text,
    });
  }

  return links;
}

function findFileLinks(lineText: string, urlLinks: readonly TerminalLink[]): TerminalLink[] {
  const links: TerminalLink[] = [];
  let match: RegExpExecArray | null;

  filePathPattern.lastIndex = 0;
  while ((match = filePathPattern.exec(lineText)) !== null) {
    const startIndex = match.index;
    const lineMatch = match[0].match(/:(\d+)(?::\d+)?$/);
    const suffix = lineMatch?.[0] ?? "";
    // 文末に続くピリオドはパスに含めない ("see /tmp/mock." の '.' を外す)
    const filePath = match[0].slice(0, match[0].length - suffix.length).replace(/\.+$/, "");
    const text = filePath + suffix;
    if (overlapsAnyLink(startIndex, startIndex + text.length, urlLinks)) {
      continue;
    }

    const fileLine = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
    if (filePath.includes("/") || filePath.includes(".")) {
      links.push({
        kind: "file",
        text,
        startIndex,
        filePath,
        fileLine,
      });
    }
  }

  return links;
}

function overlapsAnyLink(
  startIndex: number,
  endIndex: number,
  links: readonly TerminalLink[],
): boolean {
  return links.some(
    (link) => startIndex < link.startIndex + link.text.length && endIndex > link.startIndex,
  );
}

function trimTrailingUrlPunctuation(text: string): string {
  let trimmed = text;
  while (trimmed.length > 0) {
    const lastChar = trimmed.at(-1);
    if (!lastChar) {
      break;
    }

    if (".,;:!?".includes(lastChar) || isUnmatchedClosingBracket(trimmed, lastChar)) {
      trimmed = trimmed.slice(0, -1);
      continue;
    }

    break;
  }
  return trimmed;
}

function isUnmatchedClosingBracket(text: string, lastChar: string): boolean {
  const matchingPair = matchingBrackets[lastChar];
  if (!matchingPair) {
    return false;
  }

  return countChar(text, lastChar) > countChar(text, matchingPair);
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const current of text) {
    if (current === char) {
      count++;
    }
  }
  return count;
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const matchingBrackets: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};
