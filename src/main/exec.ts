import { spawn } from "child_process";
import fs from "fs";

interface RunResult {
  stdout: Buffer;
  // コマンドが失敗したときだけ入る。成功なら null。
  error: Error | null;
}

export async function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return (await execBuffer(cmd, args, cwd)).toString("utf-8");
}

export async function execBuffer(cmd: string, args: string[], cwd: string): Promise<Buffer> {
  const { stdout, error } = await run(cmd, args, cwd);
  if (error) {
    throw error;
  }
  return stdout;
}

// 失敗しても投げず、そこまでに出た stdout と失敗の理由を両方返す。エラーを報告しつつ
// 使える出力も stdout に出すコマンド (gh api graphql など) のためのもの。
export async function execAllowingFailure(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; error: Error | null }> {
  const { stdout, error } = await run(cmd, args, cwd);
  return { stdout: stdout.toString("utf-8"), error };
}

function run(cmd: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let spawnError: NodeJS.ErrnoException | null = null;

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      spawnError = error;
    });
    child.on("close", (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks);
      if (spawnError || code !== 0) {
        // spawn は「コマンドが存在しない」と「cwd が存在しない」をどちらも
        // 同じ ENOENT で報告するため、cwd の存在を確認して区別する
        if (spawnError?.code === "ENOENT" && !fs.existsSync(cwd)) {
          const cwdError = new Error(`Working directory does not exist: ${cwd}`);
          Object.assign(cwdError, { cause: spawnError });
          resolve({ stdout, error: cwdError });
          return;
        }
        const detail = Buffer.concat(stderrChunks).toString("utf-8").trim();
        const commandFailure = signal
          ? `${cmd} was terminated by ${signal}`
          : `${cmd} exited with code ${code ?? "unknown"}`;
        const nextError = new Error(detail || spawnError?.message || commandFailure);
        Object.assign(nextError, {
          code: spawnError?.code ?? code,
          cause: spawnError ?? undefined,
        });
        resolve({ stdout, error: nextError });
        return;
      }
      resolve({ stdout, error: null });
    });
  });
}
