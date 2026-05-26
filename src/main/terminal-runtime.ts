import type * as pty from "node-pty";

export interface TerminalRuntimeInfo {
  repoPath: string;
  worktreePath: string;
  startedAt: number;
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
