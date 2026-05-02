import type { SessionProvider } from "./session.js";

export interface RepoMetadata {
  id: string;
  repoPath: string;
}

export interface PrimarySessionMetadata {
  provider: SessionProvider;
  providerSessionId: string;
}

export type SuggestedSessionMetadata = PrimarySessionMetadata;

export interface TaskWorktreeMetadata {
  taskWorktreeId: string;
  repoId: string;
  worktreePath: string;
  primarySession?: PrimarySessionMetadata;
}

export interface TaskWorktreeListItem {
  taskWorktreeId: string;
  worktreePath: string;
  name: string;
  primarySession?: PrimarySessionMetadata;
  suggestedSessions: SuggestedSessionMetadata[];
}

export interface RepoListItem extends RepoMetadata {
  taskWorktrees: TaskWorktreeListItem[];
}

export interface YuruMetadata {
  repos: RepoMetadata[];
  taskWorktrees: TaskWorktreeMetadata[];
}
