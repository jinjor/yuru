import type { AgentDefinition } from "./agent.js";
import type { GitHubPullRequest, Session, SessionProvider } from "./session.js";

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

export interface GitFileStatus {
  path: string;
  status: string;
}

export interface GitPathState {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  ignored: boolean;
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

export interface BranchContext {
  branch: string | null;
  github: GitHubPullRequest | null;
}

export interface ActiveSessionState {
  sessionId: string;
  cwd: string;
}

export interface ElectronAPI {
  getSessions: () => Promise<Session[]>;
  getSessionProviders: () => Promise<AgentDefinition[]>;
  getErrors: () => Promise<AppErrorNotice[]>;
  dismissError: (id: string) => Promise<void>;
  clearErrors: () => Promise<void>;
  selectSession: (session: Session) => Promise<Result<boolean>>;
  createSession: (provider: SessionProvider, repoPath: string) => Promise<Result<Session>>;
  createWorktreeSession: (
    provider: SessionProvider,
    repoPath: string,
    branchName: string,
  ) => Promise<Result<Session>>;
  removeWorktree: (
    provider: SessionProvider,
    repoPath: string,
    worktreePath: string,
  ) => Promise<Result<boolean>>;
  selectFolder: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  getGitPathStates: (sessionId: string) => Promise<Result<GitPathState[]>>;
  getGitBranchContext: (sessionId: string) => Promise<Result<BranchContext>>;
  getGitDiffDocument: (sessionId: string, filePath: string) => Promise<Result<GitDiffDocument | null>>;
  listFiles: (sessionId: string, relativePath?: string) => Promise<Result<FileTreeNode[]>>;
  resolveRepoFile: (sessionId: string, filePath: string) => Promise<string | null>;
  syncFileWatchTargets: (sessionId: string, relativePaths: string[]) => Promise<void>;
  onErrorAdded: (callback: (error: AppErrorNotice) => void) => void;
  onErrorRemoved: (callback: (id: string) => void) => void;
  onErrorsCleared: (callback: () => void) => void;
  onSessionsStateChanged: (callback: (active: ActiveSessionState[]) => void) => void;
  onFileTreeChanged: (callback: (sessionId: string, relativePath: string) => void) => () => void;
  attachPty: (sessionId: string) => Promise<string>;
  readyPty: (sessionId: string) => Promise<void>;
  detachPty: (sessionId: string) => Promise<void>;
  ptyWrite: (sessionId: string, data: string) => void;
  ptyResize: (sessionId: string, cols: number, rows: number) => void;
  onPtyData: (callback: (sessionId: string, data: string) => void) => () => void;
}
