import type { AgentActivityState, SessionProvider } from "../shared/session.js";
import type { AgentDefinition } from "../shared/agent.js";
import type { PendingTerminal, TerminalRuntimeInfo } from "./terminal-runtime.js";
import type { WorktreeSessionHint } from "./worktree-session-detection.js";

export interface SessionSnapshot {
  provider: SessionProvider;
  providerSessionId: string;
  project: string;
  lastMessage: string;
  timestamp: number;
}

export interface SessionPreview {
  lastMessage: string;
  timestamp: number;
}

export interface StoredSessionActivityContext {
  outputActive: boolean;
}

export interface AgentTerminalRuntimeInfo extends TerminalRuntimeInfo {
  provider: SessionProvider;
  providerSessionId: string | null;
}

export interface PendingSession extends PendingTerminal {
  provider: SessionProvider;
  providerSessionId: string | null;
  existingProviderSessionIds: ReadonlySet<string>;
}

export interface LaunchRequest {
  cwd: string;
  args: string[];
  worktreePath: string;
  existingProviderSessionIds?: ReadonlySet<string>;
}

export interface WorktreeContext {
  repoPath: string;
  worktreePath: string;
  worktreeName: string;
  branchName: string;
}

export interface ResumeSessionTarget {
  provider: SessionProvider;
  providerSessionId: string;
  // Directory to launch the resume in (where the provider stored the session).
  cwd: string;
  project: string;
}

export interface SessionProviderAdapter {
  definition: AgentDefinition;
  command: string;
  resolvesSessionIdLazily: boolean;
  loadStoredSessions(): Promise<SessionSnapshot[]>;
  loadStoredSessionPreview(providerSessionId: string): Promise<SessionPreview | null>;
  loadStoredSessionActivity(
    providerSessionId: string,
    context?: StoredSessionActivityContext,
  ): Promise<AgentActivityState | null>;
  loadWorktreeSessionHints(worktreePaths: readonly string[]): Promise<WorktreeSessionHint[]>;
  hasStoredSession(providerSessionId: string): Promise<boolean>;
  createResumeLaunch(session: ResumeSessionTarget): Promise<LaunchRequest>;
  createWorktreeLaunch(context: WorktreeContext): Promise<LaunchRequest>;
  prepareWorktree(context: WorktreeContext): Promise<void>;
  finalizeWorktree(context: WorktreeContext): Promise<void>;
  resolveWorktreePath(repoPath: string, worktreeName: string): string;
  waitForSessionId(pending: PendingSession): Promise<string>;
}
