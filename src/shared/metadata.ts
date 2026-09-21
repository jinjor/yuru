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

// 一覧の骨組みとしての worktree。repo と worktree の顔ぶれ・並び・Git の位置だけを表し、
// session や PR のように頻繁に変わる表示状態は持たない (それは WorktreeDetail 側)。
export interface WorktreeListItem {
  worktreeId: string;
  worktreePath: string;
  name: string;
  branch: string | null;
  headSha: string | null;
  headCommittedAt?: number;
  isMainWorktree?: boolean;
}

// 一覧の表示に必要な分だけを renderer へ渡す。worktreeOrder は taskWorktrees の並びとして
// 既に反映済みなので含めない。
export interface RepoListItem {
  id: string;
  repoPath: string;
  // origin が github.com のときの owner/repository。Terminal の Issue / PR link に使う。
  githubRepoSlug?: string;
  mainWorktree: WorktreeListItem;
  taskWorktrees: WorktreeListItem[];
}

// worktree 1 件ぶんの表示状態。カードと WorktreeView がそれぞれ worktreeId で取得・購読する。
// 一覧 (RepoListItem) と違い、session の開始・終了や最新メッセージの更新で頻繁に変わる。
export interface WorktreeDetail {
  worktreeId: string;
  primarySessions: PrimarySessionListItem[];
  // この worktree に現在結びつく全 terminal runtime。provider session は primary link、
  // ID 未確定 runtime と standalone terminal は launch target から導出する。renderer 側で
  // 「表示中の runtime がまだ生きているか」を判定するために使う。
  activeTerminalRuntimeIds: string[];
  // null は「この branch に PR が無い」ことと「まだ GitHub から取れていない」ことの両方。
  // どちらもバッジを出さないので区別しない。
  githubPullRequest: GitHubPullRequest | null;
}

export interface YuruMetadata {
  repos: RepoMetadata[];
  taskWorktrees: TaskWorktreeMetadata[];
}
