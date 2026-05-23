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

const filePathPattern = /[\w./-][\w./-]*\.\w+(?::(\d+)(?::\d+)?)?/g;
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
    const text = match[0];
    const startIndex = match.index;
    if (overlapsAnyLink(startIndex, startIndex + text.length, urlLinks)) {
      continue;
    }

    const filePath = text.replace(/:\d+(?::\d+)?$/, "");
    const lineMatch = text.match(/:(\d+)(?::\d+)?$/);
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
