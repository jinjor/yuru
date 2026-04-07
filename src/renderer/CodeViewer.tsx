import { useEffect, useState } from "react";
import { SourceViewer, type SourceLine } from "./SourceViewer";
import { tokenizeCode } from "./highlight";

interface CodeViewerProps {
  content: string | null;
  filePath: string | null;
  fileSize: number | null;
  isLoading: boolean;
  isBinary: boolean;
  scrollToLine?: number;
}

export function CodeViewer({
  content,
  filePath,
  fileSize,
  isLoading,
  isBinary,
  scrollToLine,
}: CodeViewerProps): JSX.Element {
  const [lines, setLines] = useState<SourceLine[]>([]);

  useEffect(() => {
    let cancelled = false;

    if (content === null) {
      setLines([]);
      return;
    }

    tokenizeCode(content, filePath, fileSize).then((tokenized) => {
      if (cancelled) {
        return;
      }
      setLines(
        tokenized.map((line, index) => ({
          tokens: line.tokens,
          lineNumber: index + 1,
        })),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [content, filePath, fileSize]);

  if (isLoading) {
    return (
      <div className="code-panel-empty">
        <p>Loading file...</p>
      </div>
    );
  }

  if (!filePath) {
    return (
      <div className="code-panel-empty">
        <p>Select a file to view code</p>
      </div>
    );
  }

  if (isBinary) {
    return (
      <div className="code-panel-empty">
        <p>Binary file preview is not available</p>
      </div>
    );
  }

  return <SourceViewer lines={lines} scrollToLine={scrollToLine} />;
}
