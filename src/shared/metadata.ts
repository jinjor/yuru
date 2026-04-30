import type { SessionProvider } from "./session.js";

export interface RepoMetadata {
  id: string;
  repoPath: string;
}

export interface PrimarySessionMetadata {
  provider: SessionProvider;
  providerSessionId: string;
}

export interface TaskWorktreeMetadata {
  taskWorktreeId: string;
  repoId: string;
  worktreePath: string;
  primarySession?: PrimarySessionMetadata;
}

export interface YuruMetadata {
  repos: RepoMetadata[];
  taskWorktrees: TaskWorktreeMetadata[];
}
