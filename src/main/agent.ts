import type { SessionProvider } from "../shared/session.js";
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

export interface AgentTerminalRuntimeInfo extends TerminalRuntimeInfo {
  provider: SessionProvider;
  providerSessionId: string | null;
}

export interface PendingSession extends PendingTerminal {
  provider: SessionProvider;
  providerSessionId: string | null;
  existingProviderSessionIds: ReadonlySet<string>;
  initialInput: string | null;
  initialPrompt: string | null;
}

export interface LaunchRequest {
  cwd: string;
  args: string[];
  worktreePath: string;
  existingProviderSessionIds?: ReadonlySet<string>;
  // Message typed into the PTY as the first user prompt once the session is
  // up. Used by providers without a launch-flag injection mechanism.
  initialInput?: string;
  // Message typed after initialInput. Kimi uses this for the requested task
  // because its worktree context already occupies the first user message.
  initialPrompt?: string;
}

export interface WorktreeContext {
  repoPath: string;
  worktreePath: string;
  worktreeName: string;
  branchName: string;
  initialPrompt?: string;
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
  loadWorktreeSessionHints(worktreePaths: readonly string[]): Promise<WorktreeSessionHint[]>;
  hasStoredSession(providerSessionId: string): Promise<boolean>;
  createResumeLaunch(session: ResumeSessionTarget): Promise<LaunchRequest>;
  createWorktreeLaunch(context: WorktreeContext): Promise<LaunchRequest>;
  waitForSessionId(pending: PendingSession): Promise<string>;
  // Provider TUIs can keep repainting while requiring user action. This only
  // detects a provider-specific signal; false does not determine the overall
  // activity state.
  detectUserActionRequired?(terminalTitle: string): boolean;
  // Whether the provider recorded the injected initialInput into the session
  // store. Only providers that launch with initialInput implement this; the
  // runtime uses it to verify the injection did not get lost.
  hasRecordedInitialInput?(providerSessionId: string, initialInput: string): Promise<boolean>;
}
