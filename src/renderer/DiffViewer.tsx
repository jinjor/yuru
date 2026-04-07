import { useEffect, useState } from "react";
import { diffArrays } from "diff";
import { SourceViewer, type SourceLine } from "./SourceViewer";
import { tokenizeCode, type TokenizedLine } from "./highlight";

interface DiffViewerProps {
  originalContent: string | null;
  currentContent: string | null;
  filePath: string | null;
  fileSize: number | null;
  isLoading: boolean;
  isBinary: boolean;
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
    } else if (change.added) {
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
    } else {
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
  }

  return result;
}

export function DiffViewer({
  originalContent,
  currentContent,
  filePath,
  fileSize,
  isLoading,
  isBinary,
}: DiffViewerProps): JSX.Element {
  const [lines, setLines] = useState<SourceLine[]>([]);

  useEffect(() => {
    let cancelled = false;

    if (originalContent === null && currentContent === null) {
      setLines([]);
      return;
    }

    const original = originalContent ?? "";
    const current = currentContent ?? "";

    Promise.all([
      tokenizeCode(original, filePath, fileSize),
      tokenizeCode(current, filePath, fileSize),
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
  }, [originalContent, currentContent, filePath, fileSize]);

  if (isLoading) {
    return (
      <div className="code-panel-empty">
        <p>Loading diff...</p>
      </div>
    );
  }

  if (!filePath) {
    return (
      <div className="code-panel-empty">
        <p>Select a file to view diff</p>
      </div>
    );
  }

  if (originalContent === null && currentContent === null) {
    return (
      <div className="code-panel-empty">
        <p>Diff preview is not available</p>
      </div>
    );
  }

  if (isBinary) {
    return (
      <div className="code-panel-empty">
        <p>Binary diff preview is not available</p>
      </div>
    );
  }

  return <SourceViewer lines={lines} className="diff-viewer" />;
}
