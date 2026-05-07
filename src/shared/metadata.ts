import type { SessionProvider } from "./session.js";

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
  preview: string;
}

export interface TaskWorktreeMetadata {
  repoId: string;
  worktreePath: string;
  primarySession?: PrimarySessionMetadata;
}

export type PrimarySessionState = "active" | "inactive";

export interface PrimarySessionListItem {
  provider: SessionProvider;
  providerSessionKey: string | null;
  activeRuntimeSessionId: string | null;
  state: PrimarySessionState;
  preview: string;
}

export interface TaskWorktreeListItem {
  worktreeId: string;
  worktreePath: string;
  name: string;
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
