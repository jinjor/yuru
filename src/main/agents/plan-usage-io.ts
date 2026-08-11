import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import os from "os";
import type { Readable } from "stream";
import type { ResolvedAgentCommand } from "./command.js";

// プラン利用状況の取得は、agent の CLI を対話的に動かして 1 つ応答を受け取る形に
// なる (標準入力に要求を書く、サーバとして起動して HTTP で聞く)。どの provider でも
// 「応答が来るか時間切れになるまで待ち、どちらでも必ず後片付けする」が要るので、
// 起動と後片付けはここに集約する。特に kimi はサーバとして起動するため、
// kill し損ねると常駐し続ける。
export async function withPlanUsageProcess<T>(
  command: ResolvedAgentCommand,
  args: readonly string[],
  timeoutMs: number,
  run: (child: ChildProcessWithoutNullStreams) => Promise<T>,
): Promise<T> {
  const child = spawnAgentCommand(command, args);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(child),
      new Promise<never>((_, reject) => {
        child.on("error", reject);
        // 応答を待っている間にプロセスが落ちたら、時間切れを待たずに理由を返す。
        child.on("close", (code, signal) => {
          reject(
            new Error(
              signal
                ? `${command.path} was terminated by ${signal}`
                : `${command.path} exited with code ${code ?? "unknown"} before responding`,
            ),
          );
        });
        timer = setTimeout(() => {
          reject(new Error(`${command.path} did not respond within ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}

// 出力を最後まで受け取って終わる CLI 向け。共通の exec() ではなくこちらを使うのは、
// 応答しないまま居座られると取得全体 (と次の tick) が止まってしまうため。
export async function runPlanUsageCommand(
  command: ResolvedAgentCommand,
  args: readonly string[],
  timeoutMs: number,
): Promise<string> {
  const child = spawnAgentCommand(command, args);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => {
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk);
      });
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (code === 0) {
          resolve(Buffer.concat(stdout).toString("utf-8"));
          return;
        }
        const detail = Buffer.concat(stderr).toString("utf-8").trim();
        reject(
          new Error(
            detail ||
              (signal
                ? `${command.path} was terminated by ${signal}`
                : `${command.path} exited with code ${code ?? "unknown"}`),
          ),
        );
      });
      timer = setTimeout(() => {
        reject(new Error(`${command.path} did not respond within ${timeoutMs}ms`));
      }, timeoutMs);
    });
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}

function spawnAgentCommand(
  command: ResolvedAgentCommand,
  args: readonly string[],
): ChildProcessWithoutNullStreams {
  return spawn(command.path, [...args], {
    // agent の CLI は cwd を見て挙動を変える (Claude の CLAUDE.md 探索、kimi の
    // workspace 判定)。利用状況はアカウント全体の話で worktree とは無関係なので、
    // どの worktree にも紐づかない一時ディレクトリで起動する。
    cwd: os.tmpdir(),
    // 実行ファイルが絶対パスでも、shebang のインタプリタは PATH から探される。
    // ログインシェルが持っていた PATH をそのまま渡す。
    env: { ...process.env, PATH: command.pathEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// 1 行 1 JSON のストリームを読む。行の途中で chunk が切れても組み立て直す。
// data イベントの中で投げた例外は呼び出し元の Promise に伝わらないので、
// 解釈に失敗したら onError に渡す。
export function readJsonLines(
  stream: Readable,
  onMessage: (message: unknown) => void,
  onError: (error: Error) => void,
): void {
  let buffer = "";
  stream.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd !== -1) {
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 1);
      if (line.trim()) {
        try {
          onMessage(JSON.parse(line));
        } catch (error) {
          onError(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }
      lineEnd = buffer.indexOf("\n");
    }
  });
}
