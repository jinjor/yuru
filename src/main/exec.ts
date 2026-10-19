import { spawn } from "child_process";
import fs from "fs";
import { pipeline } from "stream/promises";

interface RunResult {
  stdout: Buffer;
  // コマンドが失敗したときだけ入る。成功なら null。
  error: Error | null;
}

// input を渡すと、それを標準入力に書き込んで閉じる。渡さなければ空の入力になる。
export async function exec(
  cmd: string,
  args: string[],
  cwd: string,
  input?: Buffer,
): Promise<string> {
  return (await execBuffer(cmd, args, cwd, input)).toString("utf-8");
}

export async function execBuffer(
  cmd: string,
  args: string[],
  cwd: string,
  input?: Buffer,
): Promise<Buffer> {
  const { stdout, error } = await run(cmd, args, cwd, input);
  if (error) {
    throw error;
  }
  return stdout;
}

// stdout をメモリに溜めず、そのままファイルへ書き出す。大きな出力の取り出し用。
export async function execToFile(
  cmd: string,
  args: string[],
  cwd: string,
  destPath: string,
): Promise<void> {
  const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const stderrChunks: Buffer[] = [];
  let spawnError: NodeJS.ErrnoException | null = null;
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });
  child.on("error", (error: NodeJS.ErrnoException) => {
    spawnError = error;
  });

  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  const [, exit] = await Promise.all([
    pipeline(child.stdout, fs.createWriteStream(destPath)),
    closed,
  ]);

  if (spawnError || exit.code !== 0) {
    const detail = Buffer.concat(stderrChunks).toString("utf-8").trim();
    const commandFailure = exit.signal
      ? `${cmd} was terminated by ${exit.signal}`
      : `${cmd} exited with code ${exit.code ?? "unknown"}`;
    const error = new Error(detail || (spawnError as Error | null)?.message || commandFailure);
    Object.assign(error, {
      code: (spawnError as NodeJS.ErrnoException | null)?.code ?? exit.code,
      cause: spawnError ?? undefined,
    });
    throw error;
  }
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

// exec が投げたエラーが、コマンドがその終了コードで終わったことによるものか。
export function isExitCode(error: unknown, code: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function run(cmd: string, args: string[], cwd: string, input?: Buffer): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let spawnError: NodeJS.ErrnoException | null = null;

    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      // 入力を読み切る前にコマンドが終了すると EPIPE になる。成否は終了コードで決まるので
      // ここでは扱わない。それ以外の書き込み失敗はコマンドの失敗として返す。
      if (error.code !== "EPIPE") {
        spawnError ??= error;
      }
    });
    child.stdin.end(input);

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
