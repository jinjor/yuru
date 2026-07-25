import os from "os";
import type { TerminalStartupCommand } from "./terminal-runtime.js";

export interface ShellLaunchCommand {
  command: string;
  args: string[];
}

// The startup command is handed to the shell as an argument rather than typed
// into the terminal. Until the shell's line editor takes over the terminal,
// everything past 1024 bytes of a single input line is silently dropped, and a
// launch flag carrying the worktree context prompt easily exceeds that.
export function createInteractiveShellLaunchCommand(
  baseEnv: Record<string, string | undefined> = process.env,
  startupCommand?: TerminalStartupCommand,
): ShellLaunchCommand {
  const args = ["-i", "-l"];
  if (startupCommand) {
    args.push("-c", buildShellExecCommand(startupCommand.command, startupCommand.args));
  }
  return {
    command: resolveUserShell(baseEnv) ?? "sh",
    args,
  };
}

// `exec` replaces the shell so the provider owns the terminal directly. A shell
// started with -c exits on its own when exec fails, carrying the failure's exit
// code out to the caller.
function buildShellExecCommand(command: string, args: readonly string[]): string {
  return `exec ${[command, ...args].map(shellQuote).join(" ")}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function resolveUserShell(baseEnv: Record<string, string | undefined>): string | null {
  return baseEnv.SHELL || os.userInfo().shell || null;
}
