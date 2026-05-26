import type * as pty from "node-pty";

export interface TerminalRuntimeInfo {
  repoPath: string;
  worktreePath: string;
  startedAt: number;
}

export interface TerminalLaunchRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  launchLabel: string;
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
  terminalRuntimeId: string | null;
  startedAt: number;
  exited: boolean;
  exitCode?: number;
  signal?: number;
  startupSettled: boolean;
  startupFailureReported: boolean;
}
