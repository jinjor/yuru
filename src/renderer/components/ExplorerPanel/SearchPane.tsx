import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppError,
  CodeSearchFileResult,
  CodeSearchMatch,
  CodeSearchRange,
} from "../../../shared/ipc";
import type { PreviewSelection } from "../../types";

interface SearchPaneProps {
  focusRequest: number;
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
  worktreeId: string;
}

interface FlatSearchMatch {
  index: number;
  file: CodeSearchFileResult;
  match: CodeSearchMatch;
}

interface IndexedSearchFile {
  file: CodeSearchFileResult;
  matches: Array<{
    index: number;
    match: CodeSearchMatch;
  }>;
}

interface SearchRows {
  files: IndexedSearchFile[];
  flatMatches: FlatSearchMatch[];
}

const SEARCH_DEBOUNCE_MS = 250;

export function SearchPane({
  focusRequest,
  onPreviewSelectionChange,
  previewSelection,
  worktreeId,
}: SearchPaneProps) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    files: CodeSearchFileResult[];
    matchCount: number;
    truncated: boolean;
    limit: number;
  } | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const searchRows = useMemo(() => {
    if (!result) {
      return { files: [], flatMatches: [] } satisfies SearchRows;
    }
    let index = 0;
    const flatMatches: FlatSearchMatch[] = [];
    const files = result.files.map((file) => {
      const matches = file.matches.map((match) => {
        const indexedMatch = { index, match };
        flatMatches.push({ index, file, match });
        index++;
        return indexedMatch;
      });
      return { file, matches };
    });
    return { files, flatMatches } satisfies SearchRows;
  }, [result]);
  const flatMatches = searchRows.flatMatches;

  useEffect(() => {
    inputRef.current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [result]);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(flatMatches.length - 1, 0)));
  }, [flatMatches.length]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    if (query.trim().length === 0) {
      setResult(null);
      setError(null);
      setIsSearching(false);
      void window.electronAPI.cancelCodeSearch(worktreeId);
      return;
    }

    setIsSearching(true);
    setError(null);
    const timeout = window.setTimeout(() => {
      void window.electronAPI
        .searchCode(worktreeId, query)
        .then((searchResult) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          setIsSearching(false);
          if (searchResult.ok) {
            setResult(searchResult.data);
            setError(null);
          } else {
            setResult(null);
            setError(searchResult.error);
          }
        })
        .catch((searchError: unknown) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          setIsSearching(false);
          setResult(null);
          setError({
            code: "unknown",
            message: searchError instanceof Error ? searchError.message : "Code search failed.",
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      void window.electronAPI.cancelCodeSearch(worktreeId);
    };
  }, [query, worktreeId]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      void window.electronAPI.cancelCodeSearch(worktreeId);
    };
  }, [worktreeId]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const selectedEl = list.querySelector<HTMLElement>(
      `[data-code-search-index="${selectedIndex}"]`,
    );
    selectedEl?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const openSelectedMatch = (): void => {
    const selected = flatMatches[selectedIndex];
    if (!selected) {
      return;
    }
    onPreviewSelectionChange({
      path: selected.file.path,
      line: selected.match.lineNumber,
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, Math.max(flatMatches.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openSelectedMatch();
    }
  };

  return (
    <div className="code-search-pane">
      <div className="code-search-input-wrap">
        <input
          ref={inputRef}
          autoFocus
          className="code-search-input"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search code"
          value={query}
        />
      </div>
      <SearchStatus
        error={error}
        isSearching={isSearching}
        matchCount={result?.matchCount ?? 0}
        query={query}
        truncated={result?.truncated ?? false}
        limit={result?.limit ?? 0}
      />
      <div className="code-search-results" ref={listRef}>
        {searchRows.files.map(({ file, matches }) => (
          <SearchFileGroup
            key={file.path}
            file={file}
            matches={matches}
            onMatchClick={(match) => {
              onPreviewSelectionChange({ path: file.path, line: match.lineNumber });
            }}
            onMatchHover={(index) => setSelectedIndex(index)}
            previewSelection={previewSelection}
            selectedIndex={selectedIndex}
          />
        ))}
      </div>
    </div>
  );
}

function SearchStatus({
  error,
  isSearching,
  matchCount,
  query,
  truncated,
  limit,
}: {
  error: AppError | null;
  isSearching: boolean;
  matchCount: number;
  query: string;
  truncated: boolean;
  limit: number;
}) {
  const trimmedQuery = query.trim();
  if (error) {
    return (
      <div className="code-search-status error" title={error.detail}>
        {error.message}
      </div>
    );
  }
  if (trimmedQuery.length === 0) {
    return <div className="code-search-status">No query</div>;
  }
  if (isSearching) {
    return <div className="code-search-status">Searching...</div>;
  }
  if (matchCount === 0) {
    return <div className="code-search-status">No results</div>;
  }
  return (
    <div className="code-search-status">
      {truncated ? `Showing first ${limit} matches` : `${matchCount} matches`}
    </div>
  );
}

function SearchFileGroup({
  file,
  matches,
  onMatchClick,
  onMatchHover,
  previewSelection,
  selectedIndex,
}: {
  file: CodeSearchFileResult;
  matches: IndexedSearchFile["matches"];
  onMatchClick: (match: CodeSearchMatch) => void;
  onMatchHover: (index: number) => void;
  previewSelection: PreviewSelection | null;
  selectedIndex: number;
}) {
  return (
    <section className="code-search-file-group">
      <div className="code-search-file-header" title={file.path}>
        <span className="code-search-file-name">{basename(file.path)}</span>
        <span className="code-search-file-dir">{dirname(file.path)}</span>
        <span className="code-search-file-count">{file.matches.length}</span>
      </div>
      {matches.map(({ index, match }) => (
        <button
          key={`${file.path}:${match.lineNumber}:${index}`}
          className={`code-search-match-row ${selectedIndex === index ? "selected" : ""} ${
            previewSelection?.path === file.path && previewSelection?.line === match.lineNumber
              ? "previewed"
              : ""
          }`}
          data-code-search-index={index}
          onClick={() => onMatchClick(match)}
          onMouseMove={() => onMatchHover(index)}
          type="button"
        >
          <span className="code-search-line">
            {renderHighlightedLine(match.line, match.ranges)}
          </span>
        </button>
      ))}
    </section>
  );
}

function renderHighlightedLine(line: string, ranges: CodeSearchRange[]): React.ReactNode {
  if (ranges.length === 0) {
    return line || " ";
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push(line.slice(cursor, range.start));
    }
    parts.push(
      <span key={index} className="code-search-highlight">
        {line.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  });
  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }
  return parts.length > 0 ? parts : " ";
}

function basename(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index >= 0 ? filePath.slice(index + 1) : filePath;
}

function dirname(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index >= 0 ? filePath.slice(0, index) : "";
}
