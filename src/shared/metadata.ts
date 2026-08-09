import type { AgentActivityState, GitHubPullRequest, SessionProvider } from "./session.js";

export interface RepoMetadata {
  id: string;
  repoPath: string;
}

export interface PrimarySessionMetadata {
  provider: SessionProvider;
  providerSessionId: string;
  // Directory to resume the session in (where the provider stored it). Optional
  // for backward compatibility with metadata written before this was recorded;
  // such entries predate promote support and were all created at the repo root.
  cwd?: string;
}

export interface SuggestedSessionListItem {
  provider: SessionProvider;
  providerSessionKey: string;
  activeTerminalRuntimeId: string | null;
  state: WorktreeSessionState;
  activityState: AgentActivityState;
  preview: string;
  timestamp: number;
}

export interface TaskWorktreeMetadata {
  repoId: string;
  worktreePath: string;
  primarySessions: PrimarySessionMetadata[];
}

export type WorktreeSessionState = "active" | "inactive";
export type PrimarySessionState = WorktreeSessionState;

export interface PrimarySessionListItem {
  provider: SessionProvider;
  providerSessionKey: string | null;
  activeTerminalRuntimeId: string | null;
  state: PrimarySessionState;
  activityState: AgentActivityState;
  preview: string;
}

export interface WorktreeListItem {
  worktreeId: string;
  worktreePath: string;
  name: string;
  branch: string | null;
  headSha: string | null;
  headCommittedAt?: number;
  isMainWorktree?: boolean;
  githubPullRequest?: GitHubPullRequest | null;
  primarySessions: PrimarySessionListItem[];
  suggestedSessions: SuggestedSessionListItem[];
  // この worktree を cwd とする、今生きている全 terminal runtime (provider の有無を問わない)。
  // renderer 側で「表示中の runtime がまだ生きているか」を props から判定するために使う
  // (SessionView の displayedTerminalRuntimeId 導出)。
  activeTerminalRuntimeIds: string[];
}

export interface RepoListItem extends RepoMetadata {
  mainWorktree: WorktreeListItem;
  taskWorktrees: WorktreeListItem[];
}

export interface YuruMetadata {
  repos: RepoMetadata[];
  taskWorktrees: TaskWorktreeMetadata[];
}
