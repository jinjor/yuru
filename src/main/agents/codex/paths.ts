import os from "os";
import path from "path";

const codexDir = path.join(os.homedir(), ".codex");
const codexHistoryPath = path.join(codexDir, "history.jsonl");
const codexSessionsDir = path.join(codexDir, "sessions");
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getCodexHistoryPath(): string {
  return codexHistoryPath;
}

export function getCodexSessionsDir(): string {
  return codexSessionsDir;
}

export function codexSessionDateDirFromId(sessionId: string): string | null {
  const timestamp = uuidV7Timestamp(sessionId);
  if (timestamp === null) {
    return null;
  }
  const date = new Date(timestamp);
  return path.join(
    codexSessionsDir,
    String(date.getFullYear()),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  );
}

function uuidV7Timestamp(sessionId: string): number | null {
  if (!UUID_V7_PATTERN.test(sessionId)) {
    return null;
  }
  return Number.parseInt(sessionId.replace(/-/g, "").slice(0, 12), 16);
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}
