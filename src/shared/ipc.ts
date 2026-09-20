import type { RepoListItem } from "./metadata.js";
import type {
  AgentActivityState,
  GitHubItem,
  GitHubPullRequest,
  ProviderPlanUsage,
  TerminalRuntimeId,
  SessionProvider,
  RateLimitStop,
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

// 画面からの Yuru 自身の更新。更新は Yuru の終了を挟んで前半と後半に分かれ、前半が
// 終わった `ready` で止まる。`unavailable` はこの app からは更新できないこと (開発版など)。
export type YuruUpdatePhase = "unavailable" | "idle" | "updating" | "ready";

export interface YuruUpdateState {
  phase: YuruUpdatePhase;
  // unavailable のときだけ入る、更新できない理由。
  reason?: string;
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

export type GitDiffScope = "base" | "staged" | "unstaged";

export interface GitFileStatus {
  path: string;
  status: string;
  lineStat?: GitLineStat;
  reviewed?: boolean;
}

export interface GitWorkingReviewCheck {
  path: string;
  unstagedReviewed: boolean;
  stagedReviewed: boolean;
}

export type GitReviewState =
  | { kind: "no-base" }
  | {
      kind: "ready";
      baseBranch: string;
      committedFiles: GitFileStatus[];
      workingChecks: GitWorkingReviewCheck[];
    };

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

// 画像・音声・動画は中身を文字列にできないので、テキストの GitDiffDocument とは別に取得する。
// 中身は要素が URL から直接読むので、ここに載るのは大きさと URL だけ。
export interface PreviewSide {
  byteLength: number;
  // <img> / <audio> / <video> の src に渡す URL。中身が変われば URL も変わる。
  url: string;
}

export interface PreviewDiffDocument {
  path: string;
  // null は元側にファイルが無いこと (例: 新規追加された画像)。
  original: PreviewSide | null;
  // null は現在側にファイルが無いこと (例: 削除された画像)。
  current: PreviewSide | null;
}

export interface HtmlPreviewGrant {
  id: string;
  url: string;
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

// task worktree の削除準備結果。追加確認が不要な ready になるまで renderer は
// 確認ダイアログを維持し、実際の Git 削除は別の IPC で開始する。
export type WorktreeRemovalPreparationOutcome =
  | { status: "ready" }
  // 生きたプロセスがあり削除しなかった (先に止める必要がある)
  | { status: "process_alive"; processes: WorktreeProcessInfo[] }
  // dirty の事前確認で通常削除を止めた (force 確認が必要。force=false のときだけ返る)
  | { status: "dirty" }
  // 初期化済み submodule の事前確認で通常削除を止めた
  | { status: "submodule" };

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

// worktree に紐づく外部リンクのブックマーク。会話の user / assistant message に出た URL を記録する。
// title は解決できるまで URL 文字列が仮 title として入る。
export interface Bookmark {
  url: string;
  title: string;
  // 貼り付けた画像のブックマーク。省略はリンク。画像の url は保存先の file:// URL で、
  // リンクと同じく一覧の識別子 (重複判定・削除・リネームのキー) になる。
  kind?: "image";
  // 画像の実体ファイルの絶対パス。url から導出できるので永続化はせず、main で組み立てる。
  // プレビューは worktree 外の絶対パスを開けるので、これをそのまま渡せば画像が出る。
  imagePath?: string;
  // GitHub の Issue / PR のときだけ載る現在の状態。GitHub から導出できる揮発値なので
  // 永続化はせず、main のポーリングが持つキャッシュから毎回組み立てる。
  status?: GitHubItem;
  // GitHub の Issue / PR は title も GitHub が正で、ポーリングのたびに追従する
  // (applyGitHubStatusChanges 参照)。手動リネームすると即座に上書きされて
  // 意味がなくなるため、そのときだけ false。URL から機械的に決まる値なので、
  // status と同じく永続化せず main 側で組み立てて渡す。
  renamable?: boolean;
}

export interface ElectronAPI {
  getRepos: () => Promise<RepoListItem[]>;
  // 並び替え後の全 repo ID。渡した順がそのまま保存される。
  reorderRepos: (repoIds: string[]) => Promise<void>;
  // 並び替え後の、その repo の全 task worktree path。今ある worktree と食い違えば保存しない。
  reorderWorktrees: (repoId: string, worktreePaths: string[]) => Promise<Result<void>>;
  // 並び替え後の、その worktree の全 primary session の key。今ある session と食い違えば
  // 保存しない。
  reorderPrimarySessions: (worktreeId: string, agentSessionKeys: string[]) => Promise<Result<void>>;
  // 購読を始める前の分を取りこぼさないための初期値。以降は push で置き換える。
  getProviderPlanUsage: () => Promise<ProviderPlanUsage[]>;
  getRateLimitStops: () => Promise<RateLimitStop[]>;
  setContinueWhenRateLimitResets: (
    terminalRuntimeId: TerminalRuntimeId,
    continueWhenReset: boolean,
  ) => Promise<void>;
  getYuruUpdateState: () => Promise<YuruUpdateState>;
  // 前半を走らせる。ready から呼ぶと、もう一度最新を取り直して build し直す。
  startYuruUpdate: () => Promise<void>;
  // 後半へ進む。Yuru が終了し、差し替えの後に新しい Yuru が立ち上がる。
  restartForYuruUpdate: () => Promise<void>;
  getErrors: () => Promise<AppErrorNotice[]>;
  dismissError: (id: string) => Promise<void>;
  clearErrors: () => Promise<void>;
  reportRendererError: (message: string, detail?: string) => void;
  resumePrimarySession: (
    worktreeId: string,
    agentSessionKey: string,
  ) => Promise<Result<WorktreeSessionSelection>>;
  resumeSuggestedSession: (
    worktreeId: string,
    agentSessionKey: string,
  ) => Promise<Result<WorktreeSessionSelection>>;
  detachPrimarySession: (worktreeId: string, agentSessionKey: string) => Promise<Result<void>>;
  createSessionForWorktree: (
    worktreeId: string,
    provider: SessionProvider,
  ) => Promise<Result<WorktreeSessionSelection>>;
  openWorktreeTerminal: (worktreeId: string) => Promise<Result<WorktreeSessionSelection>>;
  killTerminalRuntime: (terminalRuntimeId: TerminalRuntimeId) => Promise<void>;
  createTaskWorktree: (
    repoPath: string,
    branchName: string,
  ) => Promise<Result<CreatedTaskWorktree>>;
  createTaskWorktreeFromRemoteBranch: (
    repoPath: string,
    branchName: string,
  ) => Promise<Result<CreatedTaskWorktree>>;
  prepareWorktreeRemoval: (
    worktreeId: string,
    force: boolean,
    processesToStop?: WorktreeProcessRef[],
  ) => Promise<Result<WorktreeRemovalPreparationOutcome>>;
  executeWorktreeRemoval: (worktreeId: string, force: boolean) => Promise<Result<void>>;
  openExternal: (url: string) => Promise<void>;
  getGitPathStates: (worktreeId: string) => Promise<Result<GitPathState[]>>;
  getReviewState: (worktreeId: string) => Promise<Result<GitReviewState | null>>;
  setFileReviewed: (
    worktreeId: string,
    path: string,
    scope: GitDiffScope | undefined,
    reviewed: boolean,
  ) => Promise<Result<void>>;
  getGitDiffDocument: (
    worktreeId: string,
    filePath: string,
    scope?: GitDiffScope,
  ) => Promise<Result<GitDiffDocument | null>>;
  // 画像・音声・動画のプレビュー用。開けない path は null。中身は含まない。
  getPreviewDiffDocument: (
    worktreeId: string,
    filePath: string,
    scope?: GitDiffScope,
  ) => Promise<Result<PreviewDiffDocument | null>>;
  createHtmlPreview: (
    worktreeId: string,
    filePath: string,
    content: string,
  ) => Promise<Result<HtmlPreviewGrant>>;
  releaseHtmlPreview: (grantId: string) => Promise<void>;
  listFiles: (worktreeId: string, relativePath?: string) => Promise<Result<FileTreeNode[]>>;
  listAllFiles: (worktreeId: string) => Promise<Result<string[]>>;
  // Cmd+P で開いたときの初期候補。新しく開いた順の相対パス。
  listRecentFiles: (worktreeId: string) => Promise<Result<string[]>>;
  recordRecentFile: (worktreeId: string, filePath: string) => Promise<void>;
  // ターミナルのファイルリンクの解決。worktree 内なら相対パス、外なら絶対パス、開けなければ null。
  resolveRepoFile: (worktreeId: string, filePath: string) => Promise<string | null>;
  readWorktreeFile: (worktreeId: string, filePath: string) => Promise<Result<string | null>>;
  writeFile: (worktreeId: string, filePath: string, content: string) => Promise<Result<void>>;
  syncFileWatchTargets: (worktreeId: string, relativePaths: string[]) => Promise<void>;
  searchCode: (worktreeId: string, query: string) => Promise<Result<CodeSearchResult>>;
  cancelCodeSearch: (worktreeId: string) => Promise<void>;
  getBookmarks: (worktreeId: string) => Promise<Result<Bookmark[]>>;
  addBookmark: (worktreeId: string, url: string) => Promise<Result<void>>;
  // クリップボードから貼り付けた画像。dataUrl は FileReader が作る data:image/…;base64,… 形式。
  addImageBookmark: (worktreeId: string, dataUrl: string) => Promise<Result<void>>;
  removeBookmark: (worktreeId: string, url: string) => Promise<Result<void>>;
  renameBookmark: (worktreeId: string, url: string, title: string) => Promise<Result<void>>;
  onYuruUpdateStateChanged: (callback: (state: YuruUpdateState) => void) => () => void;
  onErrorNoticesChanged: (callback: (notices: AppErrorNotice[]) => void) => () => void;
  onRepoListChanged: (callback: () => void) => () => void;
  onTerminalRuntimeExited: (callback: (terminalRuntimeId: TerminalRuntimeId) => void) => () => void;
  onSessionChanged: (
    callback: (terminalRuntimeId: TerminalRuntimeId, update: SessionUpdate) => void,
  ) => () => void;
  onPullRequestsChanged: (callback: (updates: PullRequestUpdate[]) => void) => () => void;
  // プランの利用状況。この配列に居る provider がインストール済みの provider でもある。
  onProviderPlanUsageChanged: (callback: (usages: ProviderPlanUsage[]) => void) => () => void;
  onRateLimitStopsChanged: (callback: (stops: RateLimitStop[]) => void) => () => void;
  onFileTreeChanged: (callback: (worktreeId: string, relativePath: string) => void) => () => void;
  onBookmarksChanged: (callback: (worktreeId: string) => void) => () => void;
  attachPty: (terminalRuntimeId: TerminalRuntimeId) => Promise<string>;
  readyPty: (terminalRuntimeId: TerminalRuntimeId) => Promise<void>;
  detachPty: (terminalRuntimeId: TerminalRuntimeId) => Promise<void>;
  ptyWrite: (terminalRuntimeId: TerminalRuntimeId, data: string) => void;
  ptyResize: (terminalRuntimeId: TerminalRuntimeId, cols: number, rows: number) => void;
  onPtyData: (callback: (terminalRuntimeId: TerminalRuntimeId, data: string) => void) => () => void;
}
