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
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    // When a specific line is requested, scroll to it. Otherwise scroll to the
    // first changed line so a diff is visible without manual scrolling. With no
    // target (e.g. an unchanged file), reset to the top.
    const target = scrollToLine
      ? container.querySelector(`[data-line="${scrollToLine}"]`)
      : container.querySelector(".diff-added, .diff-deleted");
    if (target) {
      target.scrollIntoView({ block: "center" });
      return;
    }
    container.scrollTop = 0;
    container.scrollLeft = 0;
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
