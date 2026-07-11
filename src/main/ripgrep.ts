import { spawn } from "child_process";
import readline from "readline";

export interface RipgrepLineMatch {
  text: string;
  lineIndex: number;
}

// rg --json の出力をストリームで読み、マッチ行のあるファイルごとに onFileMatches を呼ぶ。
// stdout 全体をバッファしないため、マッチ総量が大きくても maxBuffer のような上限にかからない。
// JSON 仕様は各メッセージが自分の path を持つことは定めている一方、ファイル間でメッセージが
// 混ざらないことまでは保証していないので、隣接性に頼らず path ごとにまとめて end で確定する。
export async function streamRipgrepLineMatches(
  args: readonly string[],
  cwd: string,
  onFileMatches: (filePath: string, lines: RipgrepLineMatch[]) => void | Promise<void>,
): Promise<void> {
  const child = spawn("rg", ["--json", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const closed = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });
  // spawn 失敗は出力ループの待機中に reject されうる。await が始まる前に unhandled rejection に
  // ならないよう、先に受け手を付けておく (エラー自体は後段の await closed で改めて投げられる)。
  closed.catch(() => {});

  const outputLines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pendingLinesByFilePath = new Map<string, RipgrepLineMatch[]>();
  try {
    for await (const outputLine of outputLines) {
      const message = parseRipgrepMessage(outputLine);
      if (!message) {
        continue;
      }
      if (message.type === "match") {
        const lines = pendingLinesByFilePath.get(message.filePath) ?? [];
        lines.push(message.line);
        pendingLinesByFilePath.set(message.filePath, lines);
      } else if (message.type === "end") {
        const lines = pendingLinesByFilePath.get(message.filePath);
        pendingLinesByFilePath.delete(message.filePath);
        if (lines) {
          await onFileMatches(message.filePath, lines);
        }
      }
    }
    await closed;
  } catch (error) {
    // 途中で止める以上 rg は役目を終えている。読み手がいなくなった子プロセスを残さない。
    child.kill();
    throw error;
  } finally {
    outputLines.close();
  }

  // rg はマッチなしを exit code 1 で表す。それ以外の非 0 は実行エラー。
  if (child.exitCode !== 0 && child.exitCode !== 1) {
    throw new Error(stderr.trim() || `rg exited with code ${String(child.exitCode)}`);
  }
}

type RipgrepMessage =
  | { type: "match"; filePath: string; line: RipgrepLineMatch }
  | { type: "end"; filePath: string };

function parseRipgrepMessage(outputLine: string): RipgrepMessage | null {
  if (!outputLine) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputLine) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const message = parsed as {
    type?: unknown;
    data?: {
      path?: { text?: unknown };
      lines?: { text?: unknown };
      line_number?: unknown;
    };
  };

  // path.text がない (非 UTF-8 パスの) ファイルは扱わない。
  if (typeof message.data?.path?.text !== "string") {
    return null;
  }
  const filePath = message.data.path.text;

  if (message.type === "match") {
    if (
      typeof message.data.lines?.text !== "string" ||
      typeof message.data.line_number !== "number"
    ) {
      return null;
    }
    return {
      type: "match",
      filePath,
      line: {
        text: stripTrailingLineBreak(message.data.lines.text),
        lineIndex: message.data.line_number - 1,
      },
    };
  }

  if (message.type === "end") {
    return { type: "end", filePath };
  }

  return null;
}

function stripTrailingLineBreak(line: string): string {
  return line.replace(/\r?\n$/, "");
}
