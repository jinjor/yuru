import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import type { ReactNode, Ref } from "react";
import type { ThemedToken } from "shiki";
import { useFind } from "./Find";

interface SearchableSourceLine {
  tokens: ThemedToken[];
}

interface FindMatch {
  lineIndex: number;
  start: number;
  end: number;
}

interface SourceFind {
  /** Find bar element. Null while the find UI is closed. */
  findBar: ReactNode;
  /** Renders a line's tokens with the current find matches highlighted. */
  renderTokens: (tokens: ThemedToken[], lineIndex: number) => ReactNode;
}

export function useSourceFind(lines: readonly SearchableSourceLine[]): SourceFind {
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const { query, activeIndex, findBar } = useFind(matches.length);
  const activeMatch = matches[activeIndex] ?? null;

  useLayoutEffect(() => {
    setMatches(computeFindMatches(lines, query));
  }, [lines, query]);

  const matchesByLine = useMemo(() => {
    const byLine = new Map<number, FindMatch[]>();
    for (const match of matches) {
      const lineMatches = byLine.get(match.lineIndex);
      if (lineMatches) {
        lineMatches.push(match);
      } else {
        byLine.set(match.lineIndex, [match]);
      }
    }
    return byLine;
  }, [matches]);

  // Attached to the active match span. Stable identity, so it fires only when
  // the active highlight moves to a different element, scrolling it into view.
  const activeMatchRef = useCallback((element: HTMLSpanElement | null) => {
    element?.scrollIntoView({ block: "center" });
  }, []);

  const renderTokens = (tokens: ThemedToken[], lineIndex: number): ReactNode =>
    renderLineTokens(tokens, matchesByLine.get(lineIndex), activeMatch, activeMatchRef);

  return { findBar, renderTokens };
}

function computeFindMatches(lines: readonly SearchableSourceLine[], query: string): FindMatch[] {
  if (query.length === 0) {
    return [];
  }
  const loweredQuery = query.toLowerCase();
  const matches: FindMatch[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const text = lines[lineIndex].tokens
      .map((token) => token.content)
      .join("")
      .toLowerCase();
    let from = 0;
    while (from <= text.length - loweredQuery.length) {
      const found = text.indexOf(loweredQuery, from);
      if (found < 0) {
        break;
      }
      matches.push({ lineIndex, start: found, end: found + loweredQuery.length });
      from = found + loweredQuery.length;
    }
  }
  return matches;
}

function renderLineTokens(
  tokens: ThemedToken[],
  lineMatches: FindMatch[] | undefined,
  activeMatch: FindMatch | null,
  activeMatchRef: Ref<HTMLSpanElement>,
): ReactNode {
  if (!lineMatches || lineMatches.length === 0) {
    return tokens.map((token, tokenIndex) => (
      <span key={tokenIndex} style={{ color: token.color }}>
        {token.content}
      </span>
    ));
  }

  const nodes: ReactNode[] = [];
  let tokenStart = 0;
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    nodes.push(
      renderTokenWithMatches(
        token,
        tokenIndex,
        tokenStart,
        lineMatches,
        activeMatch,
        activeMatchRef,
      ),
    );
    tokenStart += token.content.length;
  }
  return nodes;
}

function renderTokenWithMatches(
  token: ThemedToken,
  tokenIndex: number,
  tokenStart: number,
  lineMatches: FindMatch[],
  activeMatch: FindMatch | null,
  activeMatchRef: Ref<HTMLSpanElement>,
): ReactNode {
  const tokenEnd = tokenStart + token.content.length;
  const segments: ReactNode[] = [];
  let cursor = tokenStart;
  for (const match of lineMatches) {
    const start = Math.max(match.start, cursor);
    const end = Math.min(match.end, tokenEnd);
    if (end <= start) {
      continue;
    }
    if (start > cursor) {
      segments.push(token.content.slice(cursor - tokenStart, start - tokenStart));
    }
    const isActive = match === activeMatch;
    // A match spanning token boundaries renders as multiple segments; attach
    // the scroll ref only to the first one so scrollIntoView fires once.
    const isActiveHead = isActive && start === match.start;
    segments.push(
      <span
        key={start}
        ref={isActiveHead ? activeMatchRef : undefined}
        className={`source-find-match ${isActive ? "active" : ""}`}
      >
        {token.content.slice(start - tokenStart, end - tokenStart)}
      </span>,
    );
    cursor = end;
  }
  if (cursor < tokenEnd) {
    segments.push(token.content.slice(cursor - tokenStart));
  }
  return (
    <span key={tokenIndex} style={{ color: token.color }}>
      {segments}
    </span>
  );
}
