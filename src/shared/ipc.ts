import type { AgentDefinition } from "./agent.js";
import type { RepoListItem } from "./metadata.js";
import type {
  GitHubPullRequest,
  RuntimeSessionId,
  Session,
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
  runtimeSessionId: RuntimeSessionId;
  cwd: string;
}

export interface ElectronAPI {
  getSessions: () => Promise<Session[]>;
  getRepos: () => Promise<RepoListItem[]>;
  getSessionProviders: () => Promise<AgentDefinition[]>;
  getErrors: () => Promise<AppErrorNotice[]>;
  dismissError: (id: string) => Promise<void>;
  clearErrors: () => Promise<void>;
  selectWorktreeSession: (
    taskWorktreeId: string,
    providerSessionKey: string,
  ) => Promise<Result<Session>>;
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
  getGitPathStates: (runtimeSessionId: RuntimeSessionId) => Promise<Result<GitPathState[]>>;
  getGitBranchContext: (runtimeSessionId: RuntimeSessionId) => Promise<Result<BranchContext>>;
  getGitDiffDocument: (runtimeSessionId: RuntimeSessionId, filePath: string) => Promise<Result<GitDiffDocument | null>>;
  listFiles: (runtimeSessionId: RuntimeSessionId, relativePath?: string) => Promise<Result<FileTreeNode[]>>;
  listAllFiles: (runtimeSessionId: RuntimeSessionId) => Promise<Result<string[]>>;
  resolveRepoFile: (runtimeSessionId: RuntimeSessionId, filePath: string) => Promise<string | null>;
  syncFileWatchTargets: (runtimeSessionId: RuntimeSessionId, relativePaths: string[]) => Promise<void>;
  onErrorAdded: (callback: (error: AppErrorNotice) => void) => void;
  onErrorRemoved: (callback: (id: string) => void) => void;
  onErrorsCleared: (callback: () => void) => void;
  onSessionsStateChanged: (callback: (active: ActiveSessionState[]) => void) => void;
  onFileTreeChanged: (callback: (runtimeSessionId: RuntimeSessionId, relativePath: string) => void) => () => void;
  attachPty: (runtimeSessionId: RuntimeSessionId) => Promise<string>;
  readyPty: (runtimeSessionId: RuntimeSessionId) => Promise<void>;
  detachPty: (runtimeSessionId: RuntimeSessionId) => Promise<void>;
  ptyWrite: (runtimeSessionId: RuntimeSessionId, data: string) => void;
  ptyResize: (runtimeSessionId: RuntimeSessionId, cols: number, rows: number) => void;
  onPtyData: (callback: (runtimeSessionId: RuntimeSessionId, data: string) => void) => () => void;
}
