import type { AgentDefinition } from "./agent.js";
import type { RepoListItem } from "./metadata.js";
import type {
  AgentActivityState,
  GitHubPullRequest,
  TerminalRuntimeId,
  SessionProvider,
} from "./session.js";

export interface AppError {
  code:
    | "command_not_found"
    | "command_failed"
    | "git_failed"
    | "filesystem_failed"
    | "invalid_path"
    | "unknown";
  message: string;
  detail?: string;
}

// error = ユーザー操作の失敗やルール外の例外。warning = バックグラウンド処理の失敗。
export type AppErrorSeverity = "error" | "warning";

export interface AppErrorNotice {
  id: string;
  severity: AppErrorSeverity;
  message: string;
  detail?: string;
  // 同一内容が連続した回数 (DevTools と同様に 1 行へまとめる)。timestamp は最終発生時刻。
  count: number;
  timestamp: number;
}

export type Result<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: AppError;
    };

export interface GitLineStat {
  added: number;
  deleted: number;
}

export type GitDiffScope = "staged" | "unstaged";

export interface GitFileStatus {
  path: string;
  status: string;
  lineStat?: GitLineStat;
}

export interface GitPathState {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  // merge conflict などで unmerged な path。この場合 indexStatus / worktreeStatus は空
  // (porcelain の XY は staged/unstaged ではなく衝突の種類を表すため、そのまま入れない)
  conflicted: boolean;
  ignored: boolean;
  stagedLineStat?: GitLineStat;
  unstagedLineStat?: GitLineStat;
  // conflicted な path のみ。HEAD ↔ 作業ツリー (scope なし diff と同じ範囲) の行数
  conflictLineStat?: GitLineStat;
}

export interface FileTreeNode {
  id: string;
  path: string;
  name: string;
  kind: "file" | "directory";
  children: FileTreeNode[] | null;
}

export interface GitDiffDocument {
  path: string;
  // null は元側にファイルが無いこと (例: 新規追加されたファイル)。
  originalContent: string | null;
  // null は作業ツリーにファイルが無いこと (例: 削除されたファイル)。"" は空ファイル。
  currentContent: string | null;
  isBinary: boolean;
  size: number;
}

export interface CodeSearchRange {
  start: number;
  end: number;
}

export interface CodeSearchMatch {
  lineNumber: number;
  line: string;
  ranges: CodeSearchRange[];
}

export interface CodeSearchFileResult {
  path: string;
  matches: CodeSearchMatch[];
}

export interface CodeSearchResult {
  query: string;
  files: CodeSearchFileResult[];
  matchCount: number;
  limit: number;
  truncated: boolean;
}

export interface WorktreeSessionSelection {
  worktreeId: string;
  terminalRuntimeId: TerminalRuntimeId;
}

export interface CreatedTaskWorktree {
  worktreeId: string;
}

export interface WorktreeProcessInfo {
  pid: number;
  command: string;
}

export interface WorktreeProcessRef {
  pid: number;
  command: string;
}

// task worktree 削除の結果。エラーではない分岐 (削除直前のプロセスチェック / dirty 拒否) を
// 確認ダイアログの差し替えに使うため、成功・ブロック理由を data として返す。
export type WorktreeRemovalOutcome =
  // worktree を削除し、一覧から項目を消した
  | { status: "removed" }
  // 生きたプロセスがあり削除しなかった (先に止める必要がある)
  | { status: "process_alive"; processes: WorktreeProcessInfo[] }
  // dirty で通常削除が拒否された (force 確認が必要。force=false のときだけ返る)
  | { status: "dirty" };

// メインプロセスが検知した、動作中セッションの変化 (活動状態・最新メッセージ)。
// 変わったフィールドだけが載る部分更新。
export interface SessionUpdate {
  activityState?: AgentActivityState;
  preview?: string;
}

// メインプロセスの PR ポーリングが検知した、worktree ごとの PR 情報の更新。
// null は「この branch に PR が無い」こと。
export interface PullRequestUpdate {
  worktreeId: string;
  pullRequest: GitHubPullRequest | null;
}

export interface ElectronAPI {
  getRepos: () => Promise<RepoListItem[]>;
  getSessionProviders: () => Promise<AgentDefinition[]>;
  getErrors: () => Promise<AppErrorNotice[]>;
  dismissError: (id: string) => Promise<void>;
  clearErrors: () => Promise<void>;
  reportRendererError: (message: string, detail?: string) => void;
  resumePrimarySession: (
    worktreeId: string,
    providerSessionKey: string,
  ) => Promise<Result<WorktreeSessionSelection>>;
  resumeSuggestedSession: (
    worktreeId: string,
    providerSessionKey: string,
  ) => Promise<Result<WorktreeSessionSelection>>;
  createSessionForWorktree: (
    worktreeId: string,
    provider: SessionProvider,
  ) => Promise<Result<WorktreeSessionSelection>>;
  openWorktreeTerminal: (worktreeId: string) => Promise<Result<WorktreeSessionSelection>>;
  createTaskWorktree: (
    repoPath: string,
    branchName: string,
  ) => Promise<Result<CreatedTaskWorktree>>;
  removeWorktree: (
    worktreeId: string,
    force: boolean,
    processesToStop?: WorktreeProcessRef[],
  ) => Promise<Result<WorktreeRemovalOutcome>>;
  openExternal: (url: string) => Promise<void>;
  getGitPathStates: (worktreeId: string) => Promise<Result<GitPathState[]>>;
  getGitDiffDocument: (
    worktreeId: string,
    filePath: string,
    scope?: GitDiffScope,
  ) => Promise<Result<GitDiffDocument | null>>;
  listFiles: (worktreeId: string, relativePath?: string) => Promise<Result<FileTreeNode[]>>;
  listAllFiles: (worktreeId: string) => Promise<Result<string[]>>;
  resolveRepoFile: (worktreeId: string, filePath: string) => Promise<string | null>;
  readWorktreeFile: (worktreeId: string, filePath: string) => Promise<Result<string | null>>;
  writeFile: (worktreeId: string, filePath: string, content: string) => Promise<Result<void>>;
  syncFileWatchTargets: (worktreeId: string, relativePaths: string[]) => Promise<void>;
  searchCode: (worktreeId: string, query: string) => Promise<Result<CodeSearchResult>>;
  cancelCodeSearch: (worktreeId: string) => Promise<void>;
  onErrorNoticesChanged: (callback: (notices: AppErrorNotice[]) => void) => () => void;
  onRepoListChanged: (callback: () => void) => () => void;
  onTerminalRuntimeExited: (callback: (terminalRuntimeId: TerminalRuntimeId) => void) => () => void;
  onSessionChanged: (
    callback: (terminalRuntimeId: TerminalRuntimeId, update: SessionUpdate) => void,
  ) => () => void;
  onPullRequestsChanged: (callback: (updates: PullRequestUpdate[]) => void) => () => void;
  onFileTreeChanged: (callback: (worktreeId: string, relativePath: string) => void) => () => void;
  attachPty: (terminalRuntimeId: TerminalRuntimeId) => Promise<string>;
  readyPty: (terminalRuntimeId: TerminalRuntimeId) => Promise<void>;
  detachPty: (terminalRuntimeId: TerminalRuntimeId) => Promise<void>;
  ptyWrite: (terminalRuntimeId: TerminalRuntimeId, data: string) => void;
  ptyResize: (terminalRuntimeId: TerminalRuntimeId, cols: number, rows: number) => void;
  onPtyData: (callback: (terminalRuntimeId: TerminalRuntimeId, data: string) => void) => () => void;
}
