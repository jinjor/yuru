import { useEffect, useState } from "react";
import { diffArrays } from "diff";
import type { GitDiffDocument, GitLineStat } from "../../shared/ipc";
import { SourceViewer, type SourceLine } from "./SourceViewer";
import { tokenizeCode, type TokenizedLine } from "../highlight";
import { PreviewPanel } from "./PreviewPanel";

interface DiffPreviewPanelProps {
  diffDocument: GitDiffDocument | null;
  isLoading: boolean;
  line?: number;
  onClose: () => void;
  path: string;
}

export function DiffPreviewPanel({
  diffDocument,
  isLoading,
  line,
  onClose,
  path,
}: DiffPreviewPanelProps) {
  const [lines, setLines] = useState<SourceLine[]>([]);
  // While a new file's diff is being fetched, `diffDocument` still holds the
  // previously shown file. Render it (with its own path) until the new diff
  // arrives so switching files does not flash a "Loading..." screen.
  const displayPath = diffDocument?.path ?? path;
  const originalContent = diffDocument?.originalContent ?? null;
  const currentContent = diffDocument?.currentContent ?? null;
  const fileSize = diffDocument?.size ?? null;
  const isBinary = diffDocument?.isBinary ?? false;
  const hasChanges = originalContent !== currentContent;
  const lineStat = hasChanges && !isBinary && lines.length > 0 ? countDiffLines(lines) : undefined;

  useEffect(() => {
    let cancelled = false;

    if (originalContent === null && currentContent === null) {
      setLines([]);
      return;
    }

    const original = originalContent ?? "";
    const current = currentContent ?? "";

    Promise.all([
      tokenizeCode(original, displayPath, fileSize),
      tokenizeCode(current, displayPath, fileSize),
    ]).then(([originalTokenized, currentTokenized]) => {
      if (cancelled) {
        return;
      }

      const originalLines = original.split("\n");
      const currentLines = current.split("\n");
      setLines(computeDiffLines(originalTokenized, currentTokenized, originalLines, currentLines));
    });

    return () => {
      cancelled = true;
    };
  }, [currentContent, fileSize, originalContent, displayPath]);

  return (
    <PreviewPanel title="Code" path={displayPath} lineStat={lineStat} onClose={onClose}>
      {diffDocument === null ? (
        <div className="code-panel-empty">
          <p>{isLoading ? "Loading..." : "Preview is not available"}</p>
        </div>
      ) : isBinary ? (
        <div className="code-panel-empty">
          <p>Binary preview is not available</p>
        </div>
      ) : (
        <SourceViewer
          lines={lines}
          className={hasChanges ? "diff-viewer" : ""}
          scrollToLine={diffDocument.path === path ? line : undefined}
        />
      )}
    </PreviewPanel>
  );
}

function countDiffLines(lines: readonly SourceLine[]): GitLineStat {
  let added = 0;
  let deleted = 0;
  for (const line of lines) {
    if (line.className === "diff-added") {
      added++;
    } else if (line.className === "diff-deleted") {
      deleted++;
    }
  }
  return { added, deleted };
}

function computeDiffLines(
  originalTokenized: TokenizedLine[],
  currentTokenized: TokenizedLine[],
  originalLines: string[],
  currentLines: string[],
): SourceLine[] {
  const changes = diffArrays(originalLines, currentLines);
  const result: SourceLine[] = [];
  let oldLineIndex = 0;
  let newLineIndex = 0;

  for (const change of changes) {
    if (change.removed) {
      for (let i = 0; i < change.count!; i++) {
        result.push({
          tokens: originalTokenized[oldLineIndex]?.tokens ?? [
            { content: originalLines[oldLineIndex] ?? "", color: "#d4d4d4", offset: 0 },
          ],
          lineNumber: undefined,
          className: "diff-deleted",
        });
        oldLineIndex++;
      }
      continue;
    }

    if (change.added) {
      for (let i = 0; i < change.count!; i++) {
        result.push({
          tokens: currentTokenized[newLineIndex]?.tokens ?? [
            { content: currentLines[newLineIndex] ?? "", color: "#d4d4d4", offset: 0 },
          ],
          lineNumber: newLineIndex + 1,
          className: "diff-added",
        });
        newLineIndex++;
      }
      continue;
    }

    for (let i = 0; i < change.count!; i++) {
      result.push({
        tokens: currentTokenized[newLineIndex]?.tokens ?? [
          { content: currentLines[newLineIndex] ?? "", color: "#d4d4d4", offset: 0 },
        ],
        lineNumber: newLineIndex + 1,
      });
      oldLineIndex++;
      newLineIndex++;
    }
  }

  return result;
}
