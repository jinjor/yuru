import type { AgentActivityState, GitHubPullRequest, SessionProvider } from "./session.js";

export interface RepoMetadata {
  id: string;
  repoPath: string;
  // task worktree の表示順 (worktreePath の配列)。ユーザーが並び替えた時にだけ書かれる。
  // 実在しない path は読み出し時に捨て、ここに無い worktree は作成日時順で末尾に並ぶ。
  worktreeOrder?: string[];
}

export interface PrimarySessionMetadata {
  provider: SessionProvider;
  agentSessionId: string;
  // Directory to resume the session in (where the agent stored it). Optional
  // for backward compatibility with metadata written before this was recorded;
  // such entries predate promote support and were all created at the repo root.
  cwd?: string;
}

export interface SuggestedSessionListItem {
  provider: SessionProvider;
  agentSessionKey: string;
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
  agentSessionKey: string | null;
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
  // この task worktree に現在結びつく全 terminal runtime。provider session は primary link、
  // ID 未確定 runtime と standalone terminal は launch target から導出する。renderer 側で
  // 「表示中の runtime がまだ生きているか」を判定するために使う。
  activeTerminalRuntimeIds: string[];
}

// 一覧の表示に必要な分だけを renderer へ渡す。worktreeOrder は taskWorktrees の並びとして
// 既に反映済みなので含めない。
export interface RepoListItem {
  id: string;
  repoPath: string;
  mainWorktree: WorktreeListItem;
  taskWorktrees: WorktreeListItem[];
}

export interface YuruMetadata {
  repos: RepoMetadata[];
  taskWorktrees: TaskWorktreeMetadata[];
}
