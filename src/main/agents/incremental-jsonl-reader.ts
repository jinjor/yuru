import fs from "fs";

interface FileCursor {
  byteOffset: number;
  fileId: string;
  mtimeMs: number;
}

export interface IncrementalJsonlReadResult {
  entries: unknown[];
  reset: boolean;
}

export class IncrementalJsonlReader {
  private cursor: FileCursor | null = null;
  private readonly filePath: string;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  read(): Promise<IncrementalJsonlReadResult | null> {
    return this.enqueue(() => this.readNext());
  }

  reset(): Promise<void> {
    return this.enqueue(() => {
      this.cursor = null;
    });
  }

  private async readNext(): Promise<IncrementalJsonlReadResult | null> {
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(this.filePath, "r");
    } catch (error) {
      if (isFileNotFoundError(error)) {
        this.cursor = null;
        return null;
      }
      throw error;
    }

    try {
      const stat = await handle.stat();
      const fileId = `${stat.dev}:${stat.ino}`;
      let cursor = this.cursor;
      const reset =
        cursor !== null &&
        (cursor.fileId !== fileId ||
          stat.size < cursor.byteOffset ||
          (stat.size === cursor.byteOffset && stat.mtimeMs !== cursor.mtimeMs));
      if (!cursor || reset) {
        cursor = {
          byteOffset: 0,
          fileId,
          mtimeMs: stat.mtimeMs,
        };
      }
      const { entries, nextByteOffset } = await readEntries(handle, cursor.byteOffset, stat.size);
      cursor.byteOffset = nextByteOffset;
      cursor.mtimeMs = stat.mtimeMs;
      this.cursor = cursor;
      return { entries, reset };
    } finally {
      await handle.close();
    }
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

async function readEntries(
  handle: fs.promises.FileHandle,
  byteOffset: number,
  fileSize: number,
): Promise<{ entries: unknown[]; nextByteOffset: number }> {
  const length = fileSize - byteOffset;
  if (length === 0) {
    return { entries: [], nextByteOffset: byteOffset };
  }
  const appended = Buffer.allocUnsafe(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const result = await handle.read(
      appended,
      bytesRead,
      length - bytesRead,
      byteOffset + bytesRead,
    );
    if (result.bytesRead === 0) {
      break;
    }
    bytesRead += result.bytesRead;
  }
  const content = appended.subarray(0, bytesRead);
  const lastNewline = content.lastIndexOf(0x0a);
  const entries =
    lastNewline >= 0 ? parseLines(content.subarray(0, lastNewline).toString("utf8")) : [];
  let nextByteOffset = byteOffset + Math.max(0, lastNewline + 1);
  const trailing = parseLine(content.subarray(lastNewline + 1).toString("utf8"));
  if (trailing !== null) {
    entries.push(trailing);
    nextByteOffset = byteOffset + bytesRead;
  }
  return { entries, nextByteOffset };
}

function parseLines(content: string): unknown[] {
  return content ? content.split("\n").flatMap((line) => parseLine(line) ?? []) : [];
}

function parseLine(line: string): unknown | null {
  if (!line) {
    return null;
  }
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
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
