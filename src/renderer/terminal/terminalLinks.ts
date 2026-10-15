import { findExternalUrls } from "../../shared/external-url.js";

export type TerminalLink =
  | {
      // ファイルかディレクトリかは区別しない。クリック時に解決して開き方を決める。
      kind: "path";
      text: string;
      startIndex: number;
      path: string;
      line?: number;
    }
  | {
      kind: "url";
      text: string;
      startIndex: number;
      url: string;
    };

// パスに使われる文字の並びと、続く `:行` / `:行:列`。パスとして扱うかは isPathLike で形から判定する。
// 並びの途中からは拾わない (`src/nested/dir` の `/nested/dir` を絶対パスとみなさない)。
const pathCandidatePattern = /(?<![\w.+/-])[\w.+/-]+(?::(\d+)(?::\d+)?)?/g;
const gitHubIssueOrPrReferencePattern =
  /(^|[^\w./-])((?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#([1-9]\d*))(?![A-Za-z0-9_])/g;

// 形だけでパスと言い切れるものに限る。`and/or` や `10/12` のような表記と区別できないため、
// 拡張子も先頭の `./` も末尾の `/` もない相対パス (`src/renderer`) は拾わない。
function isPathLike(path: string): boolean {
  return (
    // 絶対パス。`/12` のような分数表記を拾わないよう、2 階層以上か末尾の `/` を要求する。
    /^\/[\w.+-]+\//.test(path) ||
    // `./` か `../` で始まる相対パス。
    /^\.\.?\//.test(path) ||
    // 末尾の `/` でディレクトリと明示したもの。`/` や `//` だけのものは除く。
    /[\w.+-]\/$/.test(path) ||
    hasFileExtension(path)
  );
}

// 拡張子。`c++` のように + を含みうる。`.gitignore` のような先頭のドットは拡張子とみなさない。
export function hasFileExtension(path: string): boolean {
  return /.\.[\w+-]+$/.test(path);
}

export function findTerminalLinks(
  lineText: string,
  currentGitHubRepoSlug: string | null = null,
): TerminalLink[] {
  const urlLinks = findUrlLinks(lineText);
  const gitHubLinks = findGitHubIssueOrPrLinks(lineText, currentGitHubRepoSlug, urlLinks);
  const pathLinks = findPathLinks(lineText, [...urlLinks, ...gitHubLinks]);
  return [...urlLinks, ...gitHubLinks, ...pathLinks].sort((a, b) => a.startIndex - b.startIndex);
}

function findUrlLinks(lineText: string): TerminalLink[] {
  return findExternalUrls(lineText).map((match) => {
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
    const issueOrPrNumber = text.slice(hashIndex + 1);
    links.push({
      kind: "url",
      text,
      startIndex,
      // GitHub redirects this route to /issues/NNNN when the number belongs to an Issue.
      url: `https://github.com/${repoSlug}/pull/${issueOrPrNumber}`,
    });
  }
  return links;
}

function findPathLinks(lineText: string, urlLinks: readonly TerminalLink[]): TerminalLink[] {
  const links: TerminalLink[] = [];
  let match: RegExpExecArray | null;

  pathCandidatePattern.lastIndex = 0;
  while ((match = pathCandidatePattern.exec(lineText)) !== null) {
    const startIndex = match.index;
    const lineMatch = match[0].match(/:(\d+)(?::\d+)?$/);
    const suffix = lineMatch?.[0] ?? "";
    // 文末に続くピリオドはパスに含めない ("see /tmp/mock." の '.' を外す)
    const path = match[0].slice(0, match[0].length - suffix.length).replace(/\.+$/, "");
    const text = path + suffix;
    if (!isPathLike(path) || overlapsAnyLink(startIndex, startIndex + text.length, urlLinks)) {
      continue;
    }

    links.push({
      kind: "path",
      text,
      startIndex,
      path,
      line: lineMatch ? parseInt(lineMatch[1], 10) : undefined,
    });
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
