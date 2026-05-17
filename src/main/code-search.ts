import { spawn } from "child_process";
import type {
  CodeSearchFileResult,
  CodeSearchMatch,
  CodeSearchRange,
  CodeSearchResult,
} from "../shared/ipc.js";

export const CODE_SEARCH_RESULT_LIMIT = 500;

interface RipgrepMatchMessage {
  type: "match";
  data: {
    path: { text: string };
    lines: { text?: string; bytes?: string };
    line_number: number;
    submatches: Array<{
      start: number;
      end: number;
    }>;
  };
}

interface ParsedCodeSearchMatch {
  path: string;
  match: CodeSearchMatch;
}

const SEARCH_PREVIEW_MAX_CHARS = 160;
const SEARCH_PREVIEW_CONTEXT_BEFORE = 48;
const SEARCH_PREVIEW_PREFIX = "...";
const SEARCH_PREVIEW_SUFFIX = "...";

export class CodeSearchCancelledError extends Error {
  constructor() {
    super("Code search was cancelled.");
    this.name = "CodeSearchCancelledError";
  }
}

export function isCodeSearchCancelledError(error: unknown): error is CodeSearchCancelledError {
  return error instanceof CodeSearchCancelledError;
}

export async function searchCode(
  workingRoot: string,
  query: string,
  options: { signal: AbortSignal; limit?: number },
): Promise<CodeSearchResult> {
  const limit = options.limit ?? CODE_SEARCH_RESULT_LIMIT;
  if (query.trim().length === 0) {
    return createEmptyCodeSearchResult(query, limit);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      "rg",
      ["--json", "--no-config", "--case-sensitive", "--fixed-strings", "--", query],
      {
        cwd: workingRoot,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const filesByPath = new Map<string, CodeSearchFileResult>();
    let matchCount = 0;
    let truncated = false;
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;
    let parseError: Error | null = null;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.signal.removeEventListener("abort", handleAbort);
      callback();
    };

    const handleAbort = (): void => {
      child.kill();
      settle(() => reject(new CodeSearchCancelledError()));
    };

    options.signal.addEventListener("abort", handleAbort);
    if (options.signal.aborted) {
      handleAbort();
      return;
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf-8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const parsedMatch = parseJsonLine(line);
          if (!parsedMatch) {
            continue;
          }
          appendSearchMatch(filesByPath, parsedMatch);
          matchCount++;
          if (matchCount >= limit) {
            truncated = true;
            child.kill();
            return;
          }
        } catch (error) {
          parseError = error instanceof Error ? error : new Error(String(error));
          child.kill();
          return;
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (error) => {
      settle(() => reject(error));
    });

    child.on("close", (code, signal) => {
      if (options.signal.aborted) {
        settle(() => reject(new CodeSearchCancelledError()));
        return;
      }

      const processEndedNormally = code === 0 || code === 1;
      if (!truncated && processEndedNormally && stdoutBuffer.length > 0) {
        try {
          const parsedMatch = parseJsonLine(stdoutBuffer);
          if (parsedMatch && matchCount < limit) {
            appendSearchMatch(filesByPath, parsedMatch);
            matchCount++;
            if (matchCount >= limit) {
              truncated = true;
            }
          }
        } catch (error) {
          parseError = error instanceof Error ? error : new Error(String(error));
        }
      }

      if (parseError) {
        settle(() => reject(parseError));
        return;
      }

      if (code === 0 || code === 1 || truncated || signal === "SIGTERM") {
        settle(() =>
          resolve({
            query,
            files: [...filesByPath.values()],
            matchCount,
            limit,
            truncated,
          }),
        );
        return;
      }

      const message = stderr.trim() || `rg exited with code ${code ?? "unknown"}.`;
      settle(() => reject(new Error(message)));
    });
  });
}

export function createEmptyCodeSearchResult(query: string, limit: number): CodeSearchResult {
  return {
    query,
    files: [],
    matchCount: 0,
    limit,
    truncated: false,
  };
}

function parseJsonLine(line: string): ParsedCodeSearchMatch | null {
  if (line.trim().length === 0) {
    return null;
  }

  const message = JSON.parse(line) as { type?: string };
  if (message.type !== "match") {
    return null;
  }

  const matchMessage = message as RipgrepMatchMessage;
  return {
    path: matchMessage.data.path.text,
    match: toCodeSearchMatch(matchMessage),
  };
}

function appendSearchMatch(
  filesByPath: Map<string, CodeSearchFileResult>,
  parsedMatch: ParsedCodeSearchMatch,
): void {
  const { match, path } = parsedMatch;
  const existing = filesByPath.get(path);
  if (existing) {
    existing.matches.push(match);
  } else {
    filesByPath.set(path, { path, matches: [match] });
  }
}

function toCodeSearchMatch(message: RipgrepMatchMessage): CodeSearchMatch {
  const lineText = message.data.lines.text;
  if (lineText === undefined) {
    throw new Error("Code search does not support non-UTF-8 search results.");
  }

  const line = trimLineEnding(lineText);
  const fullLineRanges = message.data.submatches.map((range) =>
    toStringRange(line, range.start, range.end),
  );
  const preview = buildPreviewLine(line, fullLineRanges);
  return {
    lineNumber: message.data.line_number,
    line: preview.line,
    ranges: preview.ranges,
  };
}

function buildPreviewLine(
  line: string,
  ranges: CodeSearchRange[],
): { line: string; ranges: CodeSearchRange[] } {
  if (ranges.length === 0) {
    return {
      line: line.trimStart().slice(0, SEARCH_PREVIEW_MAX_CHARS),
      ranges: [],
    };
  }

  const firstRange = ranges[0];
  const sliceStart = Math.max(0, firstRange.start - SEARCH_PREVIEW_CONTEXT_BEFORE);
  const sliceEnd = Math.min(
    line.length,
    Math.max(sliceStart + SEARCH_PREVIEW_MAX_CHARS, firstRange.end),
  );
  const prefix = sliceStart > 0 ? SEARCH_PREVIEW_PREFIX : "";
  const suffix = sliceEnd < line.length ? SEARCH_PREVIEW_SUFFIX : "";
  const previewText = line.slice(sliceStart, sliceEnd);
  const rawTrimOffset = previewText.length - previewText.trimStart().length;
  const trimOffset = Math.min(rawTrimOffset, firstRange.start - sliceStart);
  const previewLine = `${prefix}${previewText.slice(trimOffset)}${suffix}`;
  const previewOffset = sliceStart + trimOffset - prefix.length;

  return {
    line: previewLine,
    ranges: ranges
      .filter((range) => range.end > sliceStart && range.start < sliceEnd)
      .map((range) => ({
        start: Math.max(prefix.length, range.start - previewOffset),
        end: Math.min(previewLine.length - suffix.length, range.end - previewOffset),
      })),
  };
}

function trimLineEnding(line: string): string {
  return line.replace(/\r?\n$/, "");
}

function toStringRange(line: string, startByte: number, endByte: number): CodeSearchRange {
  return {
    start: byteOffsetToStringIndex(line, startByte),
    end: byteOffsetToStringIndex(line, endByte),
  };
}

function byteOffsetToStringIndex(text: string, byteOffset: number): number {
  return Buffer.from(text, "utf-8").subarray(0, byteOffset).toString("utf-8").length;
}
