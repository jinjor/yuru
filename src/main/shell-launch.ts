import os from "os";

export interface ShellLaunchCommand {
  command: string;
  args: string[];
}

export function createShellLaunchCommand(
  command: string,
  args: readonly string[],
  baseEnv: Record<string, string | undefined> = process.env,
): ShellLaunchCommand {
  const shell = baseEnv.SHELL || os.userInfo().shell;
  if (!shell) {
    return { command, args: [...args] };
  }

  return {
    command: shell,
    args: ["-i", "-l", "-c", buildShellExecCommand(command, args)],
  };
}

export function buildShellExecCommand(command: string, args: readonly string[]): string {
  return `exec ${[command, ...args].map(shellQuote).join(" ")}`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
