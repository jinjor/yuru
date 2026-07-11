import { spawn } from "child_process";

export async function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return (await run(cmd, args, cwd)).toString("utf-8");
}

export async function execBuffer(cmd: string, args: string[], cwd: string): Promise<Buffer> {
  return run(cmd, args, cwd);
}

function run(cmd: string, args: string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
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
      if (spawnError || code !== 0) {
        const detail = Buffer.concat(stderrChunks).toString("utf-8").trim();
        const commandFailure = signal
          ? `${cmd} was terminated by ${signal}`
          : `${cmd} exited with code ${code ?? "unknown"}`;
        const nextError = new Error(detail || spawnError?.message || commandFailure);
        Object.assign(nextError, {
          code: spawnError?.code ?? code,
          cause: spawnError ?? undefined,
        });
        reject(nextError);
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });
  });
}
