export type SessionProvider = "claude" | "codex";

export interface GitHubPullRequest {
  prNumber: number;
  state: "open" | "merged" | "closed";
  url?: string;
}

export interface Session {
  id: string;
  provider: SessionProvider;
  providerSessionId: string | null;
  project: string;
  projectName: string;
  repoPath: string;
  lastMessage: string;
  timestamp: number;
  state: "active" | "inactive" | "archived";
  worktree?: {
    name: string;
    branch: string;
  };
  github?: GitHubPullRequest | null;
}

export function toSessionKey(provider: SessionProvider, providerSessionId: string): string {
  return `${provider}:${providerSessionId}`;
}

export function toRuntimeSessionKey(provider: SessionProvider, startedAt: number): string {
  return `${provider}:runtime:${startedAt}`;
}

export interface ResumableSession extends Session {
  providerSessionId: string;
}

export function isResumableSession(session: Session): session is ResumableSession {
  return session.providerSessionId !== null;
}
