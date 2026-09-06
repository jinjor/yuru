import { diffArrays } from "diff";
import type { GitLineStat } from "../../shared/ipc";

// 差分のひとかたまり。追加だけ・削除だけ・その両方 (行の書き換え) のいずれもありうる。
export interface DiffHunk {
  // 現在の内容での 1-based 行番号。追加があればその先頭行、削除だけなら削除跡の直後の行。
  line: number;
  addedCount: number;
  removedCount: number;
  // 現在の内容の末尾での削除。直後の行が無いので line は最終行を指す。
  atEnd: boolean;
}

export interface DiffHunks {
  hunks: DiffHunk[];
  stat: GitLineStat;
}

// 隣り合う削除と追加は 1 つの hunk にまとめる (行の書き換えを別々の削除と追加に割らない)。
export function computeDiffHunks(originalLines: string[], currentLines: string[]): DiffHunks {
  const changes = diffArrays(originalLines, currentLines);
  const hunks: DiffHunk[] = [];
  let added = 0;
  let deleted = 0;
  let currentLineNumber = 1;
  let i = 0;

  while (i < changes.length) {
    if (!changes[i].added && !changes[i].removed) {
      currentLineNumber += changes[i].count ?? 0;
      i++;
      continue;
    }

    const startLine = currentLineNumber;
    let addedCount = 0;
    let removedCount = 0;
    while (i < changes.length && (changes[i].added === true || changes[i].removed === true)) {
      const count = changes[i].count ?? 0;
      if (changes[i].added) {
        addedCount += count;
        currentLineNumber += count;
      } else {
        removedCount += count;
      }
      i++;
    }

    added += addedCount;
    deleted += removedCount;
    const atEnd = startLine > currentLines.length;
    hunks.push({ line: atEnd ? currentLines.length : startLine, addedCount, removedCount, atEnd });
  }

  return { hunks, stat: { added, deleted } };
}
