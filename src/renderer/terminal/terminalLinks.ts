import { findHttpUrls } from "../../shared/http-url.js";

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
const gitHubIssueOrPrReferencePattern =
  /(^|[^\w./-])((?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#([1-9]\d*))(?![A-Za-z0-9_])/g;

export function findTerminalLinks(
  lineText: string,
  currentGitHubRepoSlug: string | null = null,
): TerminalLink[] {
  const urlLinks = findUrlLinks(lineText);
  const gitHubLinks = findGitHubIssueOrPrLinks(lineText, currentGitHubRepoSlug, urlLinks);
  const fileLinks = findFileLinks(lineText, [...urlLinks, ...gitHubLinks]);
  return [...urlLinks, ...gitHubLinks, ...fileLinks].sort((a, b) => a.startIndex - b.startIndex);
}

function findUrlLinks(lineText: string): TerminalLink[] {
  return findHttpUrls(lineText).map((match) => {
    return {
      kind: "url",
      text: match.url,
      startIndex: match.startIndex,
      url: match.url,
    };
  });
}

function findGitHubIssueOrPrLinks(
  lineText: string,
  currentGitHubRepoSlug: string | null,
  urlLinks: readonly TerminalLink[],
): TerminalLink[] {
  const links: TerminalLink[] = [];
  let match: RegExpExecArray | null;

  gitHubIssueOrPrReferencePattern.lastIndex = 0;
  while ((match = gitHubIssueOrPrReferencePattern.exec(lineText)) !== null) {
    const text = match[2];
    const startIndex = match.index + match[1].length;
    if (overlapsAnyLink(startIndex, startIndex + text.length, urlLinks)) {
      continue;
    }

    const hashIndex = text.lastIndexOf("#");
    const repoSlug = hashIndex === 0 ? currentGitHubRepoSlug : text.slice(0, hashIndex);
    if (!repoSlug) {
      continue;
    }
    const issueNumber = text.slice(hashIndex + 1);
    links.push({
      kind: "url",
      text,
      startIndex,
      // GitHub redirects this route to /pull/NNNN when the number belongs to a PR.
      url: `https://github.com/${repoSlug}/issues/${issueNumber}`,
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
