import os from "os";
import path from "path";

// CHISEL_SESSION_DB is devin's own override for where the CLI keeps its session
// store. Tests point it at a fixture database.
const sessionsDbPath =
  process.env.CHISEL_SESSION_DB ??
  path.join(os.homedir(), ".local", "share", "devin", "cli", "sessions.db");

export function devinSessionsDbPath(): string {
  return sessionsDbPath;
}
