import { useEffect, useState } from "react";
import type { FileContent } from "../../shared/ipc";
import { SourceViewer, type SourceLine } from "./SourceViewer";
import { tokenizeCode } from "../highlight";
import { PreviewPanel } from "./PreviewPanel";

interface FilePreviewPanelProps {
  fileContent: FileContent | null;
  isLoading: boolean;
  line?: number;
  onClose: () => void;
  path: string;
}

export function FilePreviewPanel({
  fileContent,
  isLoading,
  line,
  onClose,
  path,
}: FilePreviewPanelProps) {
  const [lines, setLines] = useState<SourceLine[]>([]);
  const content = fileContent?.content ?? null;
  const filePath = fileContent?.path ?? path;
  const fileSize = fileContent?.size ?? null;
  const isBinary = fileContent?.isBinary ?? false;

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
        tokenized.map((tokenizedLine, index) => ({
          tokens: tokenizedLine.tokens,
          lineNumber: index + 1,
        })),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [content, filePath, fileSize]);

  return (
    <PreviewPanel title="Code" path={path} onClose={onClose}>
      {isLoading && (
        <div className="code-panel-empty">
          <p>Loading file...</p>
        </div>
      )}
      {!isLoading && !filePath && (
        <div className="code-panel-empty">
          <p>Select a file to view code</p>
        </div>
      )}
      {!isLoading && filePath && isBinary && (
        <div className="code-panel-empty">
          <p>Binary file preview is not available</p>
        </div>
      )}
      {!isLoading && filePath && !isBinary && (
        <SourceViewer lines={lines} scrollToLine={line} />
      )}
    </PreviewPanel>
  );
}
