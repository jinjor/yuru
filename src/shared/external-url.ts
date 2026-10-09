export interface ExternalUrlMatch {
  url: string;
  startIndex: number;
}

// chrome:// はブラウザの内部ページだが、Chrome を指定すれば OS 経由で開ける。
const externalUrlProtocols = new Set(["http:", "https:", "chrome:"]);

export function isExternalUrlProtocol(protocol: string): boolean {
  return externalUrlProtocols.has(protocol);
}

const urlPattern = /\b(?:https?|chrome):\/\/[^\s<>"'`]+/g;

export function findExternalUrls(text: string): ExternalUrlMatch[] {
  const matches: ExternalUrlMatch[] = [];
  let match: RegExpExecArray | null;

  urlPattern.lastIndex = 0;
  while ((match = urlPattern.exec(text)) !== null) {
    const url = trimTrailingUrlPunctuation(match[0]);
    if (!isExternalUrl(url)) {
      continue;
    }

    matches.push({
      url,
      startIndex: match.index,
    });
  }

  return matches;
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
  const openingBracket = openingBrackets[lastChar];
  if (!openingBracket) {
    return false;
  }

  return countCharacter(text, lastChar) > countCharacter(text, openingBracket);
}

function countCharacter(text: string, character: string): number {
  let count = 0;
  for (const current of text) {
    if (current === character) {
      count++;
    }
  }
  return count;
}

function isExternalUrl(text: string): boolean {
  try {
    return isExternalUrlProtocol(new URL(text).protocol);
  } catch {
    return false;
  }
}

const openingBrackets: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};
