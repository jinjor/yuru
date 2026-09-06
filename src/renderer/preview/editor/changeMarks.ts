import type { DiffHunk } from "../diffHunks";

export type ChangeKind = "added" | "deleted" | "deleted-end";

export interface ChangeMark {
  // 1-based の現在行番号
  line: number;
  kind: ChangeKind;
}

// 差分のかたまりを、エディタのガターに出す行単位のマークに変換する。追加を含むかたまりは緑の
// 追加行だけで示して赤マークは出さない (同じ行に緑と赤を重ねない)。削除だけのかたまりは削除跡の
// 位置に赤マークを出す。
export function toChangeMarks(hunks: readonly DiffHunk[]): ChangeMark[] {
  const marks: ChangeMark[] = [];
  for (const hunk of hunks) {
    if (hunk.addedCount > 0) {
      for (let offset = 0; offset < hunk.addedCount; offset++) {
        marks.push({ line: hunk.line + offset, kind: "added" });
      }
      continue;
    }
    marks.push({ line: hunk.line, kind: hunk.atEnd ? "deleted-end" : "deleted" });
  }
  return marks;
}
