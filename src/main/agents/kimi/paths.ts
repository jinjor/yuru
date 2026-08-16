import os from "os";
import path from "path";

// KIMI_CODE_HOME replaces ~/.kimi-code entirely (verified against kimi 0.26.0).
const kimiDir = process.env.KIMI_CODE_HOME ?? path.join(os.homedir(), ".kimi-code");
const sessionIndexPath = path.join(kimiDir, "session_index.jsonl");
const sessionsDir = path.join(kimiDir, "sessions");

export function kimiSessionIndexPath(): string {
  return sessionIndexPath;
}

export function kimiSessionsDir(): string {
  return sessionsDir;
}

export function kimiSessionStatePath(sessionDir: string): string {
  return path.join(sessionDir, "state.json");
}

export function kimiSessionLogPath(sessionDir: string): string {
  return path.join(sessionDir, "logs", "kimi-code.log");
}

export function kimiWireLogPath(sessionDir: string): string {
  return path.join(sessionDir, "agents", "main", "wire.jsonl");
}
