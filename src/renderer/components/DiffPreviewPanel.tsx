import { useEffect, useState } from "react";
import { diffArrays } from "diff";
import type { GitDiffDocument } from "../../shared/ipc";
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
  const originalContent = diffDocument?.originalContent ?? null;
  const currentContent = diffDocument?.currentContent ?? null;
  const fileSize = diffDocument?.size ?? null;
  const isBinary = diffDocument?.isBinary ?? false;
  const hasChanges = originalContent !== currentContent;

  useEffect(() => {
    let cancelled = false;

    if (originalContent === null && currentContent === null) {
      setLines([]);
      return;
    }

    const original = originalContent ?? "";
    const current = currentContent ?? "";

    Promise.all([
      tokenizeCode(original, path, fileSize),
      tokenizeCode(current, path, fileSize),
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
  }, [currentContent, fileSize, originalContent, path]);

  return (
    <PreviewPanel title="Code" path={path} onClose={onClose}>
      {isLoading && (
        <div className="code-panel-empty">
          <p>Loading...</p>
        </div>
      )}
      {!isLoading && !path && (
        <div className="code-panel-empty">
          <p>Select a file to preview</p>
        </div>
      )}
      {!isLoading && path && originalContent === null && currentContent === null && (
        <div className="code-panel-empty">
          <p>Preview is not available</p>
        </div>
      )}
      {!isLoading && path && isBinary && (
        <div className="code-panel-empty">
          <p>Binary preview is not available</p>
        </div>
      )}
      {!isLoading && path && !isBinary && (originalContent !== null || currentContent !== null) && (
        <SourceViewer
          lines={lines}
          className={hasChanges ? "diff-viewer" : ""}
          scrollToLine={line}
        />
      )}
    </PreviewPanel>
  );
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
