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

  const markers = computeDiffMarkers(lines);

  return (
    <div className="source-viewer-wrap">
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
      {markers.length > 0 && (
        <div className="diff-overview-ruler" aria-hidden="true">
          {markers.map((marker, index) => (
            <span
              key={index}
              className={`diff-overview-mark ${marker.className}`}
              style={{
                top: `${(marker.start / lines.length) * 100}%`,
                height: `${(marker.count / lines.length) * 100}%`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DiffMarker {
  start: number;
  count: number;
  className: string;
}

function computeDiffMarkers(lines: SourceLine[]): DiffMarker[] {
  const markers: DiffMarker[] = [];

  for (let index = 0; index < lines.length; index++) {
    const className = lines[index].className;
    if (className !== "diff-added" && className !== "diff-deleted") {
      continue;
    }
    const last = markers[markers.length - 1];
    if (last && last.className === className && last.start + last.count === index) {
      last.count++;
    } else {
      markers.push({ start: index, count: 1, className });
    }
  }

  return markers;
}
