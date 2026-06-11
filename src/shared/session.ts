export type SessionProvider = "claude" | "codex";
export type TerminalRuntimeId = string;

export interface SuggestedWorktreeSession {
  provider: SessionProvider;
  providerSessionId: string;
  // Directory the session was created in (where the provider stores it). Carried
  // so promoting the session can record where to resume it.
  cwd: string;
  timestamp: number;
}

export interface GitHubPullRequest {
  prNumber: number;
  state: "open" | "merged" | "closed";
  url: string;
}

export function toSessionKey(provider: SessionProvider, providerSessionId: string): string {
  return `${provider}:${providerSessionId}`;
}
