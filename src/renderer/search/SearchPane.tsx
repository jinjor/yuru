import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppError,
  CodeSearchFileResult,
  CodeSearchMatch,
  CodeSearchRange,
} from "../../shared/ipc";
import type { PreviewSelection } from "../previewSelection";

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
  // 直近に検索が完了した (成功・失敗を問わない) query。タブを離れて戻ると Activity の
  // 再 mount でこの effect も再実行されるが、query 自体が変わっていなければ検索結果は
  // VSCode などと同じ「取得した時点のスナップショット」として扱い、取り直さない。
  // debounce 中に離脱してキャンセルされた場合は完了扱いにしないので、戻った時に
  // 未完了だった検索がちゃんと走る。
  const lastCompletedQueryRef = useRef<string | null>(null);
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
    if (query.trim().length === 0) {
      lastCompletedQueryRef.current = null;
      setResult(null);
      setError(null);
      setIsSearching(false);
      return;
    }

    if (lastCompletedQueryRef.current === query) {
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsSearching(true);
    setError(null);
    const timeout = window.setTimeout(() => {
      void window.electronAPI
        .searchCode(worktreeId, query)
        .then((searchResult) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          lastCompletedQueryRef.current = query;
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
          lastCompletedQueryRef.current = query;
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

  const handleQueryChange = (nextQuery: string): void => {
    // effect cleanup は描画後なので、大量の直前結果を再描画してからではキャンセルが遅い。
    // 入力イベントの時点で古い検索リクエストと結果を無効にして、rg もすぐ停止する。
    requestIdRef.current += 1;
    void window.electronAPI.cancelCodeSearch(worktreeId);
    // ここで result/error を空にするので、後段の effect が「この query は完了済み」と
    // 誤判定しないよう完了記録も一緒に捨てる (打ち直して同じ文字列に戻るケースの対策)。
    lastCompletedQueryRef.current = null;
    setQuery(nextQuery);
    setResult(null);
    setError(null);
    setIsSearching(nextQuery.trim().length > 0);
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
          onChange={(event) => handleQueryChange(event.target.value)}
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
