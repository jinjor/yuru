import os from "os";

export interface ShellLaunchCommand {
  command: string;
  args: string[];
}

export function createInteractiveShellLaunchCommand(
  baseEnv: Record<string, string | undefined> = process.env,
): ShellLaunchCommand {
  return {
    command: resolveUserShell(baseEnv) ?? "sh",
    args: ["-i", "-l"],
  };
}

export function buildShellExecCommand(command: string, args: readonly string[]): string {
  return `exec ${[command, ...args].map(shellQuote).join(" ")}`;
}

export function buildShellStartupCommand(command: string, args: readonly string[]): string {
  return `${buildShellExecCommand(command, args)} || exit $?`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function resolveUserShell(baseEnv: Record<string, string | undefined>): string | null {
  return baseEnv.SHELL || os.userInfo().shell || null;
}
