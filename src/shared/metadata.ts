import type { GitHubPullRequest, SessionProvider } from "./session.js";

export interface RepoMetadata {
  id: string;
  repoPath: string;
}

export interface PrimarySessionMetadata {
  provider: SessionProvider;
  providerSessionId: string;
}

export interface SuggestedSessionListItem {
  provider: SessionProvider;
  providerSessionKey: string;
  activeTerminalRuntimeId: string | null;
  state: WorktreeSessionState;
  preview: string;
  timestamp: number;
}

export interface TaskWorktreeMetadata {
  repoId: string;
  worktreePath: string;
  primarySession?: PrimarySessionMetadata;
}

export type WorktreeSessionState = "active" | "inactive";
export type PrimarySessionState = WorktreeSessionState;

export interface PrimarySessionListItem {
  provider: SessionProvider;
  providerSessionKey: string | null;
  activeTerminalRuntimeId: string | null;
  state: PrimarySessionState;
  preview: string;
}

export interface TaskWorktreeListItem {
  worktreeId: string;
  worktreePath: string;
  name: string;
  branch: string | null;
  headSha: string;
  githubPullRequest?: GitHubPullRequest | null;
  primarySession?: PrimarySessionListItem;
  suggestedSessions: SuggestedSessionListItem[];
}

export interface RepoListItem extends RepoMetadata {
  taskWorktrees: TaskWorktreeListItem[];
}

export interface YuruMetadata {
  repos: RepoMetadata[];
  taskWorktrees: TaskWorktreeMetadata[];
}
