import type * as pty from "node-pty";
import type { SessionProvider } from "../../shared/session.js";
import type { TerminalScreen } from "./screen.js";

export type TerminalRuntimeKind = SessionProvider | "standalone";

interface TerminalRuntimeBase {
  launchWorktreePath: string;
  startedAt: number;
}

export type TerminalRuntimeInfo =
  | (TerminalRuntimeBase & { provider: null; agentSessionId: null })
  | (TerminalRuntimeBase & { provider: SessionProvider; agentSessionId: null })
  | (TerminalRuntimeBase & { provider: SessionProvider; agentSessionId: string });

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
  screen: TerminalScreen;
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
