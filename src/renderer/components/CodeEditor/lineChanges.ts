import { diffArrays } from "diff";
import type { GitLineStat } from "../../../shared/ipc";

export type ChangeKind = "added" | "deleted" | "deleted-end";

export interface ChangeMark {
  // 1-based の現在行番号
  line: number;
  kind: ChangeKind;
}

export interface LineChanges {
  marks: ChangeMark[];
  stat: GitLineStat;
}

// 削除マークは「純粋な削除」のときだけ出す。直前か直後が追加なら、その箇所は変更として
// 緑 (added) 側で示されるので赤マークは出さない (緑/赤の二重表示を避ける)。
export function computeLineChanges(originalLines: string[], currentLines: string[]): LineChanges {
  const changes = diffArrays(originalLines, currentLines);
  const marks: ChangeMark[] = [];
  let added = 0;
  let deleted = 0;
  let currentLineNumber = 1;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const count = change.count ?? 0;

    if (change.added) {
      for (let k = 0; k < count; k++) {
        marks.push({ line: currentLineNumber, kind: "added" });
        currentLineNumber++;
      }
      added += count;
      continue;
    }

    if (change.removed) {
      deleted += count;
      const neighbourAdded = changes[i - 1]?.added === true || changes[i + 1]?.added === true;
      if (!neighbourAdded) {
        if (currentLineNumber <= currentLines.length) {
          marks.push({ line: currentLineNumber, kind: "deleted" });
        } else {
          marks.push({ line: currentLines.length, kind: "deleted-end" });
        }
      }
      continue;
    }

    currentLineNumber += count;
  }

  return { marks, stat: { added, deleted } };
}
