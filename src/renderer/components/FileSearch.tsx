import { useEffect, useMemo, useRef, useState } from "react";
import { resultDataOrNull } from "../utils/result";

interface FileSearchProps {
  onClose: () => void;
  onSelectFile: (path: string) => void;
  sessionId: string;
}

interface MatchRange {
  start: number;
  end: number;
}

interface FileCandidate {
  path: string;
  basename: string;
  dir: string;
}

interface ScoredResult {
  candidate: FileCandidate;
  score: number;
  basenameMatches: MatchRange[];
  dirMatches: MatchRange[];
}

const MAX_RESULTS = 200;

export function FileSearch({ onClose, onSelectFile, sessionId }: FileSearchProps) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<FileCandidate[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .listAllFiles(sessionId)
      .then((result) => {
        if (cancelled) {
          return;
        }
        const paths = resultDataOrNull(result) ?? [];
        setCandidates(paths.map(toCandidate));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const results = useMemo(() => {
    if (!candidates || query.trim().length === 0) {
      return [] as ScoredResult[];
    }
    return scoreCandidates(candidates, query);
  }, [candidates, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const selectedEl = list.querySelector<HTMLElement>(
      `[data-file-search-index="${selectedIndex}"]`,
    );
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, Math.max(results.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = results[selectedIndex];
      if (result) {
        onSelectFile(result.candidate.path);
        onClose();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
  };

  return (
    <div className="file-search-overlay" onClick={onClose}>
      <div className="file-search" onClick={(event) => event.stopPropagation()}>
        <div className="file-search-input-wrap">
          <input
            autoFocus
            className="file-search-input"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files by name"
            value={query}
          />
        </div>
        <div className="file-search-results" ref={listRef}>
          {results.map((result, index) => (
            <FileSearchRow
              key={result.candidate.path}
              index={index}
              isSelected={index === selectedIndex}
              onClick={() => {
                onSelectFile(result.candidate.path);
                onClose();
              }}
              onHover={() => setSelectedIndex(index)}
              result={result}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FileSearchRow({
  index,
  isSelected,
  onClick,
  onHover,
  result,
}: {
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onHover: () => void;
  result: ScoredResult;
}) {
  const { candidate, basenameMatches, dirMatches } = result;
  return (
    <div
      className={`file-search-row ${isSelected ? "selected" : ""}`}
      data-file-search-index={index}
      onClick={onClick}
      onMouseMove={onHover}
    >
      <span className="file-search-name">
        {renderHighlighted(candidate.basename, basenameMatches, "file-search-match")}
      </span>
      {candidate.dir.length > 0 && (
        <span className="file-search-path">
          {renderHighlighted(candidate.dir, dirMatches, "file-search-match-subtle")}
        </span>
      )}
    </div>
  );
}

function renderHighlighted(
  text: string,
  matches: MatchRange[],
  matchClass: string,
): React.ReactNode {
  if (matches.length === 0) {
    return text;
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start));
    }
    parts.push(
      <span key={index} className={matchClass}>
        {text.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}

function toCandidate(filePath: string): FileCandidate {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash < 0) {
    return { path: filePath, basename: filePath, dir: "" };
  }
  return {
    path: filePath,
    basename: filePath.slice(lastSlash + 1),
    dir: filePath.slice(0, lastSlash),
  };
}

function scoreCandidates(candidates: FileCandidate[], query: string): ScoredResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 0);
  if (terms.length === 0) {
    return [];
  }

  const scored: ScoredResult[] = [];
  for (const candidate of candidates) {
    const basenameLower = candidate.basename.toLowerCase();
    const dirLower = candidate.dir.toLowerCase();

    const basenameMatches: MatchRange[] = [];
    const dirMatches: MatchRange[] = [];
    let allTermsMatch = true;

    for (const term of terms) {
      const basenameIndex = basenameLower.indexOf(term);
      const dirIndex = dirLower.indexOf(term);
      if (basenameIndex < 0 && dirIndex < 0) {
        allTermsMatch = false;
        break;
      }
      if (basenameIndex >= 0) {
        basenameMatches.push({ start: basenameIndex, end: basenameIndex + term.length });
      }
      if (dirIndex >= 0) {
        dirMatches.push({ start: dirIndex, end: dirIndex + term.length });
      }
    }

    if (!allTermsMatch) {
      continue;
    }

    const primaryTerm = terms[0];
    const primaryBasenameIndex = basenameLower.indexOf(primaryTerm);
    let score: number;
    if (primaryBasenameIndex === 0 && basenameLower === primaryTerm) {
      score = 400;
    } else if (primaryBasenameIndex === 0) {
      score = 200;
    } else if (primaryBasenameIndex > 0) {
      score = 100;
    } else {
      score = 10;
    }

    scored.push({
      candidate,
      score,
      basenameMatches: mergeRanges(basenameMatches),
      dirMatches: mergeRanges(dirMatches),
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.candidate.path.length !== b.candidate.path.length) {
      return a.candidate.path.length - b.candidate.path.length;
    }
    return a.candidate.path.localeCompare(b.candidate.path);
  });

  return scored.slice(0, MAX_RESULTS);
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) {
    return ranges;
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: MatchRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}
