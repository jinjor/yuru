export type SessionProvider = "claude" | "codex";

export interface Session {
  id: string;
  provider: SessionProvider;
  providerSessionId: string;
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
}

export function toSessionKey(provider: SessionProvider, providerSessionId: string): string {
  return `${provider}:${providerSessionId}`;
}
