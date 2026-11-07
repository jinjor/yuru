import type { GitDiffScope } from "../../shared/ipc";

export interface PreviewSelection {
  // worktree 内のファイルは worktree 基準の相対パス、外のファイルは絶対パス。
  path: string;
  line?: number;
  // Changes pane から選んだ時だけ入る。なしは HEAD ↔ 作業ツリーの合算 diff。
  scope?: GitDiffScope;
}

// 右ペインのパス (PreviewSelection の path と同じ形) が worktree の外を指すか。
export function isExternalPath(path: string): boolean {
  return path.startsWith("/");
}
