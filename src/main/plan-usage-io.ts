import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import os from "os";
import type { Readable } from "stream";

// プラン利用状況の取得は、provider の CLI を対話的に動かして 1 つ応答を受け取る形に
// なる (標準入力に要求を書く、サーバとして起動して HTTP で聞く)。どの provider でも
// 「応答が来るか時間切れになるまで待ち、どちらでも必ず後片付けする」が要るので、
// 起動と後片付けはここに集約する。特に kimi はサーバとして起動するため、
// kill し損ねると常駐し続ける。
export async function withPlanUsageProcess<T>(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  run: (child: ChildProcessWithoutNullStreams) => Promise<T>,
): Promise<T> {
  // provider の CLI は cwd を見て挙動を変える (Claude の CLAUDE.md 探索、kimi の
  // workspace 判定)。利用状況はアカウント全体の話で worktree とは無関係なので、
  // どの worktree にも紐づかない一時ディレクトリで起動する。
  const child = spawn(command, [...args], {
    cwd: os.tmpdir(),
    stdio: ["pipe", "pipe", "pipe"],
  });
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
                ? `${command} was terminated by ${signal}`
                : `${command} exited with code ${code ?? "unknown"} before responding`,
            ),
          );
        });
        timer = setTimeout(() => {
          reject(new Error(`${command} did not respond within ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    child.kill();
  }
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
