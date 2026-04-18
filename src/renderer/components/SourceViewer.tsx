import { useEffect, useRef } from "react";
import type { ThemedToken } from "shiki";

export interface SourceLine {
  tokens: ThemedToken[];
  lineNumber?: number;
  className?: string;
}

interface SourceViewerProps {
  lines: SourceLine[];
  className?: string;
  scrollToLine?: number;
}

export function SourceViewer({ lines, className, scrollToLine }: SourceViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
  }, [lines]);

  useEffect(() => {
    if (!scrollToLine || !scrollRef.current) {
      return;
    }
    const lineElement = scrollRef.current.querySelector(`[data-line="${scrollToLine}"]`);
    if (lineElement) {
      lineElement.scrollIntoView({ block: "center" });
    }
  }, [lines, scrollToLine]);

  return (
    <div ref={scrollRef} className={`source-viewer ${className ?? ""}`}>
      <div className="source-viewer-content">
        {lines.map((line, index) => (
          <div
            key={index}
            className={`source-line ${line.className ?? ""} ${line.lineNumber === scrollToLine ? "highlight" : ""}`}
            data-line={line.lineNumber}
          >
            <span className="source-gutter">{line.lineNumber ?? ""}</span>
            <span className="source-code">
              {line.tokens.map((token, tokenIndex) => (
                <span key={tokenIndex} style={{ color: token.color }}>
                  {token.content}
                </span>
              ))}
              {line.tokens.length === 0 && "\n"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
