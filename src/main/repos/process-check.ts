import { exec } from "../exec.js";
import { isPathWithin } from "../worktree-identity.js";
import type { WorktreeProcessInfo } from "../../shared/ipc.js";

interface LsofCwdProcess {
  pid: number;
  cwd: string;
}

// その worktree を作業場所 (cwd) にしている生きたプロセスを OS に問い合わせる。
// 削除でディレクトリと git の管理情報が消えても、cwd を失ったプロセスは死なずに残り、
// 以降の操作が全部失敗して気づきにくい。git は守ってくれないので Yuru 側で先回りして防ぐ。
//
// 開いているファイルハンドルは消しても閉じるまで生きるので幽霊化しない。cwd だけ見れば十分。
// lsof は自分自身も列挙するため、対象 worktree の外 (repo root) で起動する。
export async function listLiveProcessesInWorktree(
  worktreePath: string,
  repoPath: string,
): Promise<WorktreeProcessInfo[]> {
  const output = await exec("lsof", ["-w", "-d", "cwd", "-F", "pn"], repoPath);
  const allProcesses = parseLsofCwdProcesses(output);
  const matchingProcesses = allProcesses.filter((processInfo) =>
    isPathWithin(worktreePath, processInfo.cwd),
  );

  const inspected = await Promise.all(
    matchingProcesses.map(async (processInfo): Promise<WorktreeProcessInfo | null> => {
      try {
        const commandOutput = await exec(
          "ps",
          ["-p", String(processInfo.pid), "-ww", "-o", "command="],
          repoPath,
        );
        return {
          pid: processInfo.pid,
          command: commandOutput.trim(),
        };
      } catch (error) {
        // lsof と ps の間に終了したプロセスは、すでに worktree を妨げていない。
        if (isProcessNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    }),
  );

  return inspected.filter(
    (processInfo): processInfo is WorktreeProcessInfo => processInfo !== null,
  );
}

export async function hasLiveProcessInWorktree(
  worktreePath: string,
  repoPath: string,
): Promise<boolean> {
  const output = await exec("lsof", ["-w", "-d", "cwd", "-F", "pn"], repoPath);
  return parseLsofCwdPaths(output).some((cwd) => isPathWithin(worktreePath, cwd));
}

export function parseLsofCwdProcesses(output: string): LsofCwdProcess[] {
  const processes: LsofCwdProcess[] = [];
  let pid: number | null = null;
  let cwd: string | null = null;

  const pushCurrent = (): void => {
    if (pid !== null && cwd !== null) {
      processes.push({ pid, cwd });
    }
  };

  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      pushCurrent();
      const parsedPid = Number(line.slice(1));
      pid = Number.isInteger(parsedPid) ? parsedPid : null;
      cwd = null;
      continue;
    }
    if (line.startsWith("n")) {
      cwd = line.slice(1);
    }
  }
  pushCurrent();

  return processes;
}

export function parseLsofCwdPaths(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
}

function isProcessNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 1
  );
}
