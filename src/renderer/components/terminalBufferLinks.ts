import type { IBuffer, IBufferLine, IBufferRange } from "@xterm/xterm";
import { findTerminalLinks, type TerminalLink } from "./terminalLinks.js";

export type TerminalBufferLink = TerminalLink & {
  range: IBufferRange;
};

const pathFragmentAtLineEndPattern = /[\w./-]+(?::\d+(?::\d+)?)?$/;

export function findTerminalLinksInBufferLine(
  buffer: IBuffer,
  cols: number,
  bufferLineNumber: number,
): TerminalBufferLink[] {
  const tuiWrappedLink = findTuiWrappedFileLink(buffer, cols, bufferLineNumber);
  if (tuiWrappedLink) {
    return [tuiWrappedLink];
  }

  const segments = getSoftWrappedLineSegments(buffer, cols, bufferLineNumber);
  if (segments.length === 0) {
    return [];
  }

  const lineText = segments.map((segment) => segment.text).join("");
  return findTerminalLinks(lineText)
    .map((link): TerminalBufferLink => {
      const range = getBufferRange(segments, link.startIndex, link.startIndex + link.text.length);
      return { ...link, range };
    })
    .filter(
      (link) => link.range.start.y <= bufferLineNumber && link.range.end.y >= bufferLineNumber,
    );
}

interface SoftWrappedLineSegment {
  bufferLineNumber: number;
  line: IBufferLine;
  joinedStartIndex: number;
  text: string;
}

function getSoftWrappedLineSegments(
  buffer: IBuffer,
  cols: number,
  bufferLineNumber: number,
): SoftWrappedLineSegment[] {
  const lineIndex = bufferLineNumber - 1;
  if (!buffer.getLine(lineIndex)) {
    return [];
  }

  let firstLineIndex = lineIndex;
  while (firstLineIndex > 0 && buffer.getLine(firstLineIndex)?.isWrapped) {
    firstLineIndex--;
  }

  let lastLineIndex = lineIndex;
  while (lastLineIndex + 1 < buffer.length && buffer.getLine(lastLineIndex + 1)?.isWrapped) {
    lastLineIndex++;
  }

  const segments: SoftWrappedLineSegment[] = [];
  let joinedStartIndex = 0;
  for (let index = firstLineIndex; index <= lastLineIndex; index++) {
    const line = buffer.getLine(index);
    if (!line) {
      throw new Error(`Terminal buffer line ${index + 1} disappeared while finding links`);
    }
    const text = line.translateToString(false, 0, Math.min(cols, line.length));
    segments.push({
      bufferLineNumber: index + 1,
      line,
      joinedStartIndex,
      text,
    });
    joinedStartIndex += text.length;
  }
  return segments;
}

function getBufferRange(
  segments: readonly SoftWrappedLineSegment[],
  startIndex: number,
  endIndex: number,
): IBufferRange {
  const start = getBufferPosition(segments, startIndex, false);
  const end = getBufferPosition(segments, endIndex, true);
  return {
    start: { x: start.cellIndex + 1, y: start.bufferLineNumber },
    end: { x: end.cellIndex, y: end.bufferLineNumber },
  };
}

function getBufferPosition(
  segments: readonly SoftWrappedLineSegment[],
  stringIndex: number,
  preferPreviousSegment: boolean,
): { bufferLineNumber: number; cellIndex: number } {
  for (const segment of segments) {
    const segmentEndIndex = segment.joinedStartIndex + segment.text.length;
    if (
      stringIndex < segmentEndIndex ||
      (preferPreviousSegment && stringIndex === segmentEndIndex)
    ) {
      return {
        bufferLineNumber: segment.bufferLineNumber,
        cellIndex: stringIndexToCellIndex(segment.line, stringIndex - segment.joinedStartIndex),
      };
    }
  }
  throw new Error(`Terminal link string index ${stringIndex} is outside its wrapped line`);
}

function stringIndexToCellIndex(line: IBufferLine, stringIndex: number): number {
  let cellIndex = 0;
  let currentStringIndex = 0;
  while (currentStringIndex < stringIndex) {
    const cell = line.getCell(cellIndex);
    if (!cell) {
      break;
    }
    currentStringIndex += cell.getChars().length || 1;
    cellIndex += Math.max(cell.getWidth(), 1);
  }
  return cellIndex;
}

interface PathFragment {
  bufferLineNumber: number;
  text: string;
  startCellIndex: number;
  endCellIndex: number;
  continuationIndent: number | undefined;
}

function findTuiWrappedFileLink(
  buffer: IBuffer,
  cols: number,
  bufferLineNumber: number,
): TerminalBufferLink | undefined {
  const fragments = getTuiWrappedPathFragments(buffer, cols, bufferLineNumber);
  if (fragments.length < 2) {
    return undefined;
  }

  const text = fragments.map((fragment) => fragment.text).join("");
  const link = findTerminalLinks(text).find(
    (candidate) =>
      candidate.kind === "file" &&
      candidate.startIndex === 0 &&
      candidate.text.length === text.length,
  );
  if (!link || link.kind !== "file") {
    return undefined;
  }

  const current = fragments.find((fragment) => fragment.bufferLineNumber === bufferLineNumber);
  if (!current) {
    throw new Error(`Terminal line ${bufferLineNumber} is outside its TUI-wrapped link`);
  }

  return {
    ...link,
    range: {
      start: {
        x: current.startCellIndex + 1,
        y: bufferLineNumber,
      },
      end: {
        x: current.endCellIndex,
        y: bufferLineNumber,
      },
    },
  };
}

function getTuiWrappedPathFragments(
  buffer: IBuffer,
  cols: number,
  bufferLineNumber: number,
): PathFragment[] {
  const currentLineIndex = bufferLineNumber - 1;
  const current = getPathFragmentAtLineEnd(buffer, cols, currentLineIndex);
  if (!current) {
    return [];
  }

  const fragments = [current];
  let continuationIndent = current.continuationIndent;
  let firstLineIndex = currentLineIndex;
  // TUI がレイアウト目的で入れた改行も xterm では isWrapped=false になる。
  // 同じ深さでインデントされた隣接行を集め、パスとしての妥当性は
  // 連結後に判定する。
  while (fragments[0].continuationIndent !== undefined && firstLineIndex > 0) {
    const previous = getPathFragmentAtLineEnd(buffer, cols, firstLineIndex - 1);
    if (!previous) {
      break;
    }
    if (
      previous.continuationIndent !== undefined &&
      previous.continuationIndent !== continuationIndent
    ) {
      break;
    }
    fragments.unshift(previous);
    firstLineIndex--;
  }

  let nextLineIndex = currentLineIndex + 1;
  while (nextLineIndex < buffer.length) {
    const next = getPathFragmentAtLineEnd(buffer, cols, nextLineIndex);
    if (next?.continuationIndent === undefined) {
      break;
    }
    if (continuationIndent !== undefined && next.continuationIndent !== continuationIndent) {
      break;
    }
    continuationIndent ??= next.continuationIndent;
    fragments.push(next);
    nextLineIndex++;
  }

  return selectTuiPathCandidate(fragments, cols, bufferLineNumber);
}

function selectTuiPathCandidate(
  fragments: readonly PathFragment[],
  cols: number,
  bufferLineNumber: number,
): PathFragment[] {
  let candidateStartIndex = 0;
  let candidateText = fragments[0].text;

  for (let index = 1; index < fragments.length; index++) {
    const next = fragments[index];
    if (isCompleteFilePath(candidateText) && isCompleteFilePath(next.text)) {
      if (bufferLineNumber < next.bufferLineNumber) {
        return acceptTuiPathCandidate(fragments.slice(candidateStartIndex, index), cols);
      }
      candidateStartIndex = index;
      candidateText = next.text;
    } else {
      candidateText += next.text;
    }
  }

  return acceptTuiPathCandidate(fragments.slice(candidateStartIndex), cols);
}

function acceptTuiPathCandidate(fragments: readonly PathFragment[], cols: number): PathFragment[] {
  const first = fragments[0];
  if (
    fragments.length < 2 ||
    (!reachesTerminalRightEdge(first, cols) && !looksLikePathFragment(first.text))
  ) {
    return [];
  }
  return [...fragments];
}

function getPathFragmentAtLineEnd(
  buffer: IBuffer,
  cols: number,
  lineIndex: number,
): PathFragment | undefined {
  const line = buffer.getLine(lineIndex);
  if (!line || line.isWrapped || buffer.getLine(lineIndex + 1)?.isWrapped) {
    return undefined;
  }

  const lineText = line.translateToString(false, 0, Math.min(cols, line.length));
  const trimmedLineText = lineText.trimEnd();
  const match = trimmedLineText.match(pathFragmentAtLineEndPattern);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const prefix = trimmedLineText.slice(0, match.index);
  return {
    bufferLineNumber: lineIndex + 1,
    text: match[0],
    startCellIndex: stringIndexToCellIndex(line, match.index),
    endCellIndex: stringIndexToCellIndex(line, match.index + match[0].length),
    continuationIndent:
      prefix.length > 0 && prefix.trim().length === 0
        ? stringIndexToCellIndex(line, prefix.length)
        : undefined,
  };
}

function reachesTerminalRightEdge(fragment: PathFragment, cols: number): boolean {
  return fragment.endCellIndex >= cols - 1;
}

function looksLikePathFragment(text: string): boolean {
  return text.includes("/") || text.includes(".");
}

function isCompleteFilePath(text: string): boolean {
  return findTerminalLinks(text).some(
    (link) =>
      link.kind === "file" &&
      link.startIndex === 0 &&
      link.startIndex + link.text.length === text.length,
  );
}
