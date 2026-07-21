import fs from "fs";
import type { SessionPreview } from "./agent.js";

interface SessionPreviewFileState {
  byteOffset: number;
  mtimeMs: number;
  preview: SessionPreview | null;
}

// Session stores are append-only JSONL files. Parse the existing file once, then
// retain only the latest preview and the last complete-line offset so polling
// work stays proportional to newly appended records instead of total conversation length.
export class IncrementalSessionPreviewReader {
  private readonly states = new Map<string, SessionPreviewFileState>();
  private readonly parseEntry: (entry: unknown) => SessionPreview | null;

  constructor(parseEntry: (entry: unknown) => SessionPreview | null) {
    this.parseEntry = parseEntry;
  }

  async read(filePath: string): Promise<SessionPreview | null> {
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(filePath, "r");
    } catch (error) {
      if (isFileNotFoundError(error)) {
        this.states.delete(filePath);
        return null;
      }
      throw error;
    }

    try {
      const stat = await handle.stat();
      let state = this.states.get(filePath);
      if (
        !state ||
        stat.size < state.byteOffset ||
        (stat.size === state.byteOffset && stat.mtimeMs !== state.mtimeMs)
      ) {
        state = {
          byteOffset: 0,
          mtimeMs: stat.mtimeMs,
          preview: null,
        };
      }

      const length = stat.size - state.byteOffset;
      if (length === 0) {
        this.states.set(filePath, state);
        return state.preview;
      }

      const appended = Buffer.allocUnsafe(length);
      let bytesRead = 0;
      while (bytesRead < length) {
        const result = await handle.read(
          appended,
          bytesRead,
          length - bytesRead,
          state.byteOffset + bytesRead,
        );
        if (result.bytesRead === 0) {
          break;
        }
        bytesRead += result.bytesRead;
      }

      const content = appended.subarray(0, bytesRead);
      const lastNewline = content.lastIndexOf(0x0a);
      if (lastNewline >= 0) {
        for (const line of content.subarray(0, lastNewline).toString("utf-8").split("\n")) {
          this.consumeLine(state, line);
        }
        state.byteOffset += lastNewline + 1;
      }

      // Preserve the previous reader's behavior for a complete final record
      // without a newline. Its bytes remain after byteOffset, so an incomplete
      // record is retried from the last complete line after more data arrives.
      const trailingLine = content.subarray(lastNewline + 1).toString("utf-8");
      this.consumeLine(state, trailingLine);
      state.mtimeMs = stat.mtimeMs;
      this.states.set(filePath, state);
      return state.preview;
    } finally {
      await handle.close();
    }
  }

  private consumeLine(state: SessionPreviewFileState, line: string): void {
    if (!line) {
      return;
    }
    try {
      const preview = this.parseEntry(JSON.parse(line) as unknown);
      if (preview && (!state.preview || preview.timestamp >= state.preview.timestamp)) {
        state.preview = preview;
      }
    } catch {
      // Session stores can be observed between append writes. The incomplete
      // final record will be retried from the last complete-line offset.
    }
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
