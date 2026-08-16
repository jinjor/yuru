import { useEffect, useMemo, useRef, useState } from "react";
import { resultDataOrNull } from "../utils/result";
import { Modal } from "../ui/Modal";
import { TextInput } from "../ui/TextInput";

interface FileSearchProps {
  onClose: () => void;
  onSelectFile: (path: string) => void;
  worktreeId: string;
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

interface FileSearchResult {
  candidate: FileCandidate;
  basenameMatches: MatchRange[];
  dirMatches: MatchRange[];
}

const MAX_RESULTS = 200;

export function FileSearch({ onClose, onSelectFile, worktreeId }: FileSearchProps) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<FileCandidate[] | null>(null);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.listAllFiles(worktreeId).then((result) => {
      if (cancelled) {
        return;
      }
      const paths = resultDataOrNull(result) ?? [];
      setCandidates(paths.map(toCandidate));
    });
    window.electronAPI.listRecentFiles(worktreeId).then((result) => {
      if (cancelled) {
        return;
      }
      setRecentPaths(resultDataOrNull(result) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [worktreeId]);

  // 入力前は「最近開いたファイル」を候補にする。
  const results = useMemo(() => {
    if (!candidates) {
      return [] as FileSearchResult[];
    }
    if (query.trim().length === 0) {
      return recentResults(candidates, recentPaths);
    }
    return scoreCandidates(candidates, query);
  }, [candidates, query, recentPaths]);

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
  };

  return (
    <Modal onClose={onClose} topOffset={100}>
      <div className="file-search">
        <div className="file-search-input-wrap">
          <TextInput
            autoFocus
            onChange={setQuery}
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
    </Modal>
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
  result: FileSearchResult;
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

// 履歴は開いた順そのものを並び順にするので、スコアもハイライトも付けない。
function recentResults(candidates: FileCandidate[], recentPaths: string[]): FileSearchResult[] {
  const candidatesByPath = new Map(candidates.map((candidate) => [candidate.path, candidate]));
  const results: FileSearchResult[] = [];
  for (const recentPath of recentPaths) {
    // もう存在しないファイルは候補一覧に居ないので、そのまま履歴から落とす。
    const candidate = candidatesByPath.get(recentPath);
    if (candidate) {
      results.push({ candidate, basenameMatches: [], dirMatches: [] });
    }
  }
  return results;
}

function scoreCandidates(candidates: FileCandidate[], query: string): FileSearchResult[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) {
    return [];
  }

  const scored: { result: FileSearchResult; score: number }[] = [];
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
      result: {
        candidate,
        basenameMatches: mergeRanges(basenameMatches),
        dirMatches: mergeRanges(dirMatches),
      },
      score,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aPath = a.result.candidate.path;
    const bPath = b.result.candidate.path;
    if (aPath.length !== bPath.length) {
      return aPath.length - bPath.length;
    }
    return aPath.localeCompare(bPath);
  });

  return scored.slice(0, MAX_RESULTS).map((entry) => entry.result);
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
