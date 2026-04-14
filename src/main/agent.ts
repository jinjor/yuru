import * as pty from "node-pty";
import { ResumableSession, SessionProvider } from "../shared/session.js";
import { AgentDefinition } from "../shared/agent.js";

export interface SessionSnapshot {
  provider: SessionProvider;
  providerSessionId: string;
  project: string;
  lastMessage: string;
  timestamp: number;
}

export interface RuntimeSessionInfo {
  cwd: string;
  provider: SessionProvider;
  providerSessionId: string | null;
  startedAt: number;
}

export interface PendingSession {
  proc: pty.IPty;
  provider: SessionProvider;
  command: string;
  launchLabel: string;
  startupOutput: string;
  sessionCwd: string;
  providerSessionId: string | null;
  appSessionId: string | null;
  startedAt: number;
  existingProviderSessionIds: ReadonlySet<string>;
  exited: boolean;
  startupSettled: boolean;
  startupFailureReported: boolean;
}

export interface LaunchRequest {
  cwd: string;
  args: string[];
  sessionCwd: string;
  existingProviderSessionIds?: ReadonlySet<string>;
}

export interface WorktreeContext {
  repoPath: string;
  worktreePath: string;
  worktreeName: string;
  branchName: string;
}

export interface SessionProviderAdapter {
  definition: AgentDefinition;
  command: string;
  resolvesSessionIdLazily: boolean;
  loadStoredSessions(): Promise<SessionSnapshot[]>;
  createNewLaunch(repoPath: string): Promise<LaunchRequest>;
  createResumeLaunch(session: ResumableSession): Promise<LaunchRequest>;
  createWorktreeLaunch(context: WorktreeContext): Promise<LaunchRequest>;
  prepareWorktree(context: WorktreeContext): Promise<void>;
  finalizeWorktree(context: WorktreeContext): Promise<void>;
  resolveWorktreePath(repoPath: string, worktreeName: string): string;
  repoPathFromProject(projectPath: string): string;
  waitForSessionId(pending: PendingSession): Promise<string>;
}
