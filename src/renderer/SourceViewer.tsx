import { useRef, useEffect } from "react";
import type { ThemedToken } from "shiki";

export interface SourceLine {
  tokens: ThemedToken[];
  lineNumber?: number;
  className?: string;
}

interface SourceViewerProps {
  lines: SourceLine[];
  className?: string;
}

export function SourceViewer({ lines, className }: SourceViewerProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
  }, [lines]);

  return (
    <div ref={scrollRef} className={`source-viewer ${className ?? ""}`}>
      <div className="source-viewer-content">
        {lines.map((line, index) => (
          <div key={index} className={`source-line ${line.className ?? ""}`}>
            <span className="source-gutter">
              {line.lineNumber ?? ""}
            </span>
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
