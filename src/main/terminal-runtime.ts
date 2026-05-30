import type * as pty from "node-pty";
import type { SessionProvider } from "../shared/session.js";

export type TerminalRuntimeKind = SessionProvider | "standalone";

export interface TerminalRuntimeInfo {
  repoPath: string;
  worktreePath: string;
  startedAt: number;
  provider?: SessionProvider;
  providerSessionId?: string | null;
}

export interface TerminalStartupCommand {
  command: string;
  args: readonly string[];
}

export interface TerminalLaunchRequest {
  cwd: string;
  env: Record<string, string>;
  launchLabel: string;
  runtimeKind: TerminalRuntimeKind;
  startupCommand?: TerminalStartupCommand;
  worktreePath: string;
}

export interface PendingTerminal {
  proc: pty.IPty;
  command: string;
  launchCwd: string;
  launchLabel: string;
  outputBuffer: string;
  startupOutput: string;
  worktreePath: string;
  terminalRuntimeId: string;
  startedAt: number;
  exited: boolean;
  exitCode?: number;
  signal?: number;
  startupSettled: boolean;
  startupFailureReported: boolean;
}
