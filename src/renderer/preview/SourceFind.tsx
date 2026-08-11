import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { ThemedToken } from "shiki";

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
  const findInputRef = useRef<HTMLInputElement>(null);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findFocusRequest, setFindFocusRequest] = useState(0);
  const [matchCursor, setMatchCursor] = useState(0);

  const findMatches = useMemo(
    () => (isFindOpen ? computeFindMatches(lines, findQuery) : []),
    [isFindOpen, lines, findQuery],
  );
  const activeMatchIndex = Math.min(matchCursor, Math.max(findMatches.length - 1, 0));
  const activeMatch = findMatches[activeMatchIndex] ?? null;

  const matchesByLine = useMemo(() => {
    const byLine = new Map<number, FindMatch[]>();
    for (const match of findMatches) {
      const lineMatches = byLine.get(match.lineIndex);
      if (lineMatches) {
        lineMatches.push(match);
      } else {
        byLine.set(match.lineIndex, [match]);
      }
    }
    return byLine;
  }, [findMatches]);

  // Attached to the active match span. Stable identity, so it fires only when
  // the active highlight moves to a different element, scrolling it into view.
  const activeMatchRef = useCallback((element: HTMLSpanElement | null) => {
    element?.scrollIntoView({ block: "center" });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isFindShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "f";
      if (!isFindShortcut) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setIsFindOpen(true);
      setFindFocusRequest((prev) => prev + 1);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  useEffect(() => {
    if (findFocusRequest === 0) {
      return;
    }
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [findFocusRequest]);

  const goToMatch = (delta: number): void => {
    if (findMatches.length === 0) {
      return;
    }
    setMatchCursor((activeMatchIndex + delta + findMatches.length) % findMatches.length);
  };

  const handleFindKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      goToMatch(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setIsFindOpen(false);
    }
  };

  const findBar = isFindOpen ? (
    <div className="source-find-bar">
      <input
        ref={findInputRef}
        autoFocus
        className="source-find-input"
        onChange={(event) => {
          setFindQuery(event.target.value);
          setMatchCursor(0);
        }}
        onKeyDown={handleFindKeyDown}
        placeholder="Find"
        value={findQuery}
      />
      <span className="source-find-count">
        {findQuery.length === 0
          ? ""
          : `${findMatches.length === 0 ? 0 : activeMatchIndex + 1}/${findMatches.length}`}
      </span>
      <button
        type="button"
        className="source-find-button"
        onClick={() => goToMatch(-1)}
        disabled={findMatches.length === 0}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp size={14} strokeWidth={2.4} />
      </button>
      <button
        type="button"
        className="source-find-button"
        onClick={() => goToMatch(1)}
        disabled={findMatches.length === 0}
        aria-label="Next match"
        title="Next match (Enter)"
      >
        <ChevronDown size={14} strokeWidth={2.4} />
      </button>
      <button
        type="button"
        className="source-find-button"
        onClick={() => setIsFindOpen(false)}
        aria-label="Close find"
        title="Close find (Escape)"
      >
        <X size={14} strokeWidth={2.4} />
      </button>
    </div>
  ) : null;

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
