import type { GitDiffScope } from "../shared/ipc";

export interface PreviewSelection {
  path: string;
  line?: number;
  // Changes pane から選んだ時だけ入る。なしは HEAD ↔ 作業ツリーの合算 diff。
  scope?: GitDiffScope;
}

// 将来プレビューを 3 つ目に足せるよう union にする (edit: boolean の二値にはしない)。
export type FileViewMode = "view" | "edit";
