export const SESSION_PROVIDER_IDS = ["claude", "codex", "kimi"] as const;
export type SessionProvider = (typeof SESSION_PROVIDER_IDS)[number];
export type TerminalRuntimeId = string;
export type AgentActivityState = "working" | "waiting";

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
  state: "open" | "draft" | "merged" | "closed";
  url: string;
}

export function toSessionKey(provider: SessionProvider, providerSessionId: string): string {
  return `${provider}:${providerSessionId}`;
}
