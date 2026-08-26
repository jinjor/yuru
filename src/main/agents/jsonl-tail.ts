import type fs from "fs";

const SCAN_CHUNK_SIZE = 64 * 1024;

export interface LatestJsonlEntry<T> {
  entry: T | null;
  completeByteOffset: number;
}

// JSONL を末尾からたどり、parser が最初に受理した record で停止する。
// completeByteOffset は末尾の改行直後を指し、呼び出し側が以後の追記だけを
// 読み進めるために使う。改行のない末尾 record は、追記途中かもしれないため
// entry として返せても offset には含めない。
export async function readLatestJsonlEntry<T>(
  handle: fs.promises.FileHandle,
  fileSize: number,
  parser: (entry: unknown) => T | null,
): Promise<LatestJsonlEntry<T>> {
  let scanEnd = fileSize;
  let lineEnd = fileSize;
  let completeByteOffset: number | null = null;

  while (scanEnd > 0) {
    const chunkStart = Math.max(0, scanEnd - SCAN_CHUNK_SIZE);
    const chunk = await readRange(handle, chunkStart, scanEnd);

    for (let index = chunk.length - 1; index >= 0; index--) {
      if (chunk[index] !== 0x0a) {
        continue;
      }

      const newlineOffset = chunkStart + index;
      completeByteOffset ??= newlineOffset + 1;
      const entry = await parseLine(handle, newlineOffset + 1, lineEnd, parser);
      if (entry !== null) {
        return { entry, completeByteOffset };
      }
      lineEnd = newlineOffset;
    }
    scanEnd = chunkStart;
  }

  const entry = await parseLine(handle, 0, lineEnd, parser);
  return { entry, completeByteOffset: completeByteOffset ?? 0 };
}

async function parseLine<T>(
  handle: fs.promises.FileHandle,
  start: number,
  end: number,
  parser: (entry: unknown) => T | null,
): Promise<T | null> {
  if (start >= end) {
    return null;
  }

  const bytes = await readRange(handle, start, end);
  const line = bytes.at(-1) === 0x0d ? bytes.subarray(0, -1) : bytes;
  if (line.length === 0) {
    return null;
  }

  try {
    return parser(JSON.parse(line.toString("utf8")) as unknown);
  } catch {
    return null;
  }
}

async function readRange(
  handle: fs.promises.FileHandle,
  start: number,
  end: number,
): Promise<Buffer> {
  const content = Buffer.allocUnsafe(end - start);
  let bytesRead = 0;
  while (bytesRead < content.length) {
    const result = await handle.read(
      content,
      bytesRead,
      content.length - bytesRead,
      start + bytesRead,
    );
    if (result.bytesRead === 0) {
      break;
    }
    bytesRead += result.bytesRead;
  }
  return content.subarray(0, bytesRead);
}
