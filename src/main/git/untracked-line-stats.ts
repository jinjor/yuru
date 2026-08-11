import fs from "fs";
import path from "path";
import type { GitLineStat } from "../../shared/ipc.js";

interface CacheEntry {
  size: number;
  mtimeMs: number;
  // null は行数を出せない file (binary、または読んでいる途中に消えた file)
  lineStat: GitLineStat | null;
}

// 同時に開く file 数の上限。fd 枯渇を避けつつ並列で読む。
const READ_CONCURRENCY = 32;

// worktree root -> (絶対 path -> cache)。
// poll のたびに現在の untracked file だけで作り直すので、消えた file の entry は自然に捨てられる。
const cacheByRoot = new Map<string, Map<string, CacheEntry>>();

// untracked file は `git diff --numstat` に出ないため、file を読んで追加行数を数える。
// size と mtime が前回と同じ file は読み直さない。
export async function getUntrackedLineStats(
  cwd: string,
  relativePaths: readonly string[],
): Promise<Map<string, GitLineStat>> {
  const previous = cacheByRoot.get(cwd) ?? new Map<string, CacheEntry>();
  const next = new Map<string, CacheEntry>();
  const result = new Map<string, GitLineStat>();

  await forEachWithConcurrency(relativePaths, READ_CONCURRENCY, async (relativePath) => {
    const absolutePath = path.join(cwd, relativePath);
    const stats = await statIfExists(absolutePath);
    if (!stats?.isFile()) {
      return;
    }

    const cached = previous.get(absolutePath);
    const entry =
      cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs
        ? cached
        : {
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            lineStat: await countAddedLines(absolutePath),
          };
    next.set(absolutePath, entry);
    if (entry.lineStat) {
      result.set(relativePath, entry.lineStat);
    }
  });

  cacheByRoot.set(cwd, next);
  return result;
}

async function countAddedLines(filePath: string): Promise<GitLineStat | null> {
  let added = 0;
  let lastByte = -1;

  try {
    for await (const chunk of fs.createReadStream(filePath)) {
      const buffer = chunk as Buffer;
      if (buffer.includes(0)) {
        // NUL byte を含む file は binary とみなす (diff preview と同じ判定)
        return null;
      }
      let index = buffer.indexOf(0x0a);
      while (index !== -1) {
        added++;
        index = buffer.indexOf(0x0a, index + 1);
      }
      if (buffer.length > 0) {
        lastByte = buffer[buffer.length - 1];
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // status 取得後に消えた file
      return null;
    }
    throw error;
  }

  if (lastByte !== -1 && lastByte !== 0x0a) {
    // 改行で終わらない最後の行も 1 行と数える (numstat と同じ)
    added++;
  }

  return { added, deleted: 0 };
}

async function statIfExists(filePath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}
