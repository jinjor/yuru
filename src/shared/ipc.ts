import type { AgentDefinition } from "./agent.js";
import type { RepoListItem } from "./metadata.js";
import type { GitHubPullRequest, TerminalRuntimeId, SessionProvider } from "./session.js";

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

export interface AppErrorNotice {
  id: string;
  message: string;
  detail?: string;
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
  ignored: boolean;
  stagedLineStat?: GitLineStat;
  unstagedLineStat?: GitLineStat;
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
  originalContent: string;
  currentContent: string;
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

export interface WorktreeDisplayUpdate {
  worktreeId: string;
  branch: string | null;
  headSha: string | null;
  githubPullRequest: GitHubPullRequest | null;
  sessionPreview?: {
    providerSessionKey: string;
    preview: string;
  };
}

export interface ElectronAPI {
  getRepos: () => Promise<RepoListItem[]>;
  getSessionProviders: () => Promise<AgentDefinition[]>;
  getErrors: () => Promise<AppErrorNotice[]>;
  dismissError: (id: string) => Promise<void>;
  clearErrors: () => Promise<void>;
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
  createWorktreeSession: (
    provider: SessionProvider,
    repoPath: string,
    branchName: string,
  ) => Promise<Result<WorktreeSessionSelection>>;
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
  syncFileWatchTargets: (worktreeId: string, relativePaths: string[]) => Promise<void>;
  searchCode: (worktreeId: string, query: string) => Promise<Result<CodeSearchResult>>;
  cancelCodeSearch: (worktreeId: string) => Promise<void>;
  onErrorAdded: (callback: (error: AppErrorNotice) => void) => void;
  onErrorRemoved: (callback: (id: string) => void) => void;
  onErrorsCleared: (callback: () => void) => void;
  onWorktreeDisplayChanged: (callback: (update: WorktreeDisplayUpdate) => void) => void;
  onSessionsStateChanged: (callback: () => void) => void;
  onTerminalRuntimeExited: (callback: (terminalRuntimeId: TerminalRuntimeId) => void) => () => void;
  onFileTreeChanged: (callback: (worktreeId: string, relativePath: string) => void) => () => void;
  attachPty: (terminalRuntimeId: TerminalRuntimeId) => Promise<string>;
  readyPty: (terminalRuntimeId: TerminalRuntimeId) => Promise<void>;
  detachPty: (terminalRuntimeId: TerminalRuntimeId) => Promise<void>;
  ptyWrite: (terminalRuntimeId: TerminalRuntimeId, data: string) => void;
  ptyResize: (terminalRuntimeId: TerminalRuntimeId, cols: number, rows: number) => void;
  onPtyData: (callback: (terminalRuntimeId: TerminalRuntimeId, data: string) => void) => () => void;
}
