import fs from "fs";

// セッションの記録に現れる印。provider がリクエストを rate limit で断った所を
// "stopped"、その後に会話が先に進んだ所を "moved-on" とする。
export type RateLimitStopMark = "stopped" | "moved-on";

// 記録の末尾から読む長さ。1 レコードがこれより長いと印が見つからず「止まっていない」に
// なるが、そのときは何もしないので安全側に外れる。
const TAIL_BYTES = 256 * 1024;

// そのセッションが rate limit で断られた所で止まったままか。記録を末尾から遡り、
// 最初に見つかった印をそのまま答えにする。間に挟まる記録用のエントリは
// classifyLine が null を返して読み飛ばす。
export async function isStoppedAtRateLimit(
  filePath: string,
  classifyLine: (line: string) => RateLimitStopMark | null,
): Promise<boolean> {
  const lines = await readTailLines(filePath);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const mark = classifyLine(lines[index]);
    if (mark !== null) {
      return mark === "stopped";
    }
  }
  return false;
}

async function readTailLines(filePath: string): Promise<string[]> {
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(filePath, "r");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, size - length);
    const lines = buffer.subarray(0, bytesRead).toString("utf-8").split("\n");
    // 末尾だけを読むと先頭は行の途中から始まりうるので捨てる。
    return size > length ? lines.slice(1) : lines;
  } finally {
    await handle.close();
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
