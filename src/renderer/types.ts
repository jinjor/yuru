import type { GitDiffScope } from "../shared/ipc";

export interface PreviewSelection {
  path: string;
  line?: number;
  // Changes pane から選んだ時だけ入る。なしは HEAD ↔ 作業ツリーの合算 diff。
  scope?: GitDiffScope;
}
