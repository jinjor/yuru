export type SessionProvider = "claude" | "codex";
export type RuntimeSessionId = string;

export interface SuggestedWorktreeSession {
  provider: SessionProvider;
  providerSessionId: string;
  timestamp: number;
}

export interface GitHubPullRequest {
  prNumber: number;
  state: "open" | "merged" | "closed";
  url?: string;
}

export function toSessionKey(provider: SessionProvider, providerSessionId: string): string {
  return `${provider}:${providerSessionId}`;
}

export function toRuntimeSessionKey(provider: SessionProvider, startedAt: number): string {
  return `${provider}:runtime:${startedAt}`;
}
