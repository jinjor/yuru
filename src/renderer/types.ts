import type { GitDiffScope } from "../shared/ipc";

export interface PreviewSelection {
  path: string;
  line?: number;
  // Changes pane から選んだ時だけ入る。なしは HEAD ↔ 作業ツリーの合算 diff。
  scope?: GitDiffScope;
}

// preview は markdown ファイルのときだけ選べる描画プレビュー。閲覧 (view)・編集 (edit) と排他。
export type FileViewMode = "preview" | "view" | "edit";
