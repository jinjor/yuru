import type { AgentDefinition } from "./agent.js";
import type { GitHubPullRequest, Session, SessionProvider } from "./session.js";

export interface GitFileStatus {
  path: string;
  status: string;
}

export interface FileTreeNode {
  id: string;
  path: string;
  name: string;
  kind: "file" | "directory";
  children: FileTreeNode[] | null;
  gitStatus?: string;
  isIgnored: boolean;
}

export interface FileContent {
  path: string;
  content: string;
  isBinary: boolean;
  size: number;
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
  selectSession: (session: Session) => void;
  createSession: (provider: SessionProvider, repoPath: string) => Promise<Session>;
  createWorktreeSession: (
    provider: SessionProvider,
    repoPath: string,
    branchName: string,
  ) => Promise<Session>;
  removeWorktree: (
    provider: SessionProvider,
    repoPath: string,
    worktreePath: string,
  ) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  getGitStatus: (sessionId: string) => Promise<GitFileStatus[]>;
  getGitBranchContext: (sessionId: string) => Promise<BranchContext>;
  getGitDiffDocument: (sessionId: string, filePath: string) => Promise<GitDiffDocument | null>;
  listFiles: (sessionId: string, relativePath?: string) => Promise<FileTreeNode[]>;
  readFile: (sessionId: string, filePath: string) => Promise<FileContent | null>;
  fileExists: (sessionId: string, filePath: string) => Promise<boolean>;
  onSessionsStateChanged: (callback: (active: ActiveSessionState[]) => void) => void;
  ptyWrite: (sessionId: string, data: string) => void;
  ptyResize: (sessionId: string, cols: number, rows: number) => void;
  onPtyData: (callback: (sessionId: string, data: string) => void) => void;
}
