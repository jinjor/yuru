import { memo, useEffect, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import type { ThemedToken } from "shiki";
import { useSourceFind } from "./SourceFind";

export interface SourceLine {
  tokens: ThemedToken[];
  lineNumber?: number;
  className?: string;
}

interface SourceViewerProps {
  lines: SourceLine[];
  className?: string;
  scrollToLine?: number;
  // クリックで動く行 (表示側の行番号)。行指定で開いた行の強調表示 (scrollToLine) とは別に持ち、
  // 見た目は focusedLineEnd だけで表す。
  focusedLine?: number;
  onFocusLine?: (lineNumber: number) => void;
  // フォーカス行の行末に出す内容。
  focusedLineEnd?: ReactNode;
}

export function SourceViewer({
  lines,
  className,
  scrollToLine,
  focusedLine,
  onFocusLine,
  focusedLineEnd,
}: SourceViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { findBar, renderTokens } = useSourceFind(lines);

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

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    // 文字列の選択を終えたときのクリックでは、フォーカスを動かさない。
    if (!onFocusLine || window.getSelection()?.isCollapsed === false) {
      return;
    }
    // 行番号を持たない行 (削除行) は data-line を持たないので、フォーカスできない。
    const lineElement = (event.target as Element).closest<HTMLElement>("[data-line]");
    const lineNumber = Number(lineElement?.dataset.line);
    if (lineNumber > 0) {
      onFocusLine(lineNumber);
    }
  };

  return (
    <div className="source-viewer-wrap">
      {findBar}
      <div ref={scrollRef} className={`source-viewer ${className ?? ""}`}>
        <div className="source-viewer-content" onClick={handleClick}>
          {lines.map((line, index) => (
            <SourceLineRow
              key={index}
              line={line}
              lineIndex={index}
              highlighted={line.lineNumber === scrollToLine}
              lineEnd={
                line.lineNumber !== undefined && line.lineNumber === focusedLine
                  ? focusedLineEnd
                  : null
              }
              renderTokens={renderTokens}
            />
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

interface SourceLineRowProps {
  line: SourceLine;
  lineIndex: number;
  highlighted: boolean;
  lineEnd: ReactNode;
  renderTokens: (tokens: ThemedToken[], lineIndex: number) => ReactNode;
}

// フォーカス行が動くたびに全行を描き直さないよう、props が変わった行だけ描き直す。
const SourceLineRow = memo(function SourceLineRow({
  line,
  lineIndex,
  highlighted,
  lineEnd,
  renderTokens,
}: SourceLineRowProps) {
  return (
    <div
      className={`source-line ${line.className ?? ""} ${highlighted ? "highlight" : ""}`}
      data-line={line.lineNumber}
    >
      <span className="source-gutter">{line.lineNumber ?? ""}</span>
      <span className="source-code">
        {renderTokens(line.tokens, lineIndex)}
        {lineEnd}
        {line.tokens.length === 0 && "\n"}
      </span>
    </div>
  );
});

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
