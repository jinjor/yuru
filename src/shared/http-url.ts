export interface HttpUrlMatch {
  url: string;
  startIndex: number;
}

const urlPattern = /\bhttps?:\/\/[^\s<>"'`]+/g;

export function findHttpUrls(text: string): HttpUrlMatch[] {
  const matches: HttpUrlMatch[] = [];
  let match: RegExpExecArray | null;

  urlPattern.lastIndex = 0;
  while ((match = urlPattern.exec(text)) !== null) {
    const url = trimTrailingUrlPunctuation(match[0]);
    if (!isHttpUrl(url)) {
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

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const openingBrackets: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};
