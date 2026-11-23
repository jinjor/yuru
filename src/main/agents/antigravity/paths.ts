import os from "os";
import path from "path";

// ANTIGRAVITY_APP_DATA_DIR is agy's own override for its app data directory.
// Tests point it at an isolated fixture directory.
const appDataDir =
  process.env.ANTIGRAVITY_APP_DATA_DIR || path.join(os.homedir(), ".gemini", "antigravity-cli");
const summariesDbPath = path.join(appDataDir, "conversation_summaries.db");
const brainDir = path.join(appDataDir, "brain");

export function antigravitySummariesDbPath(): string {
  return summariesDbPath;
}

export function antigravityBrainDir(): string {
  return brainDir;
}

export function antigravityTranscriptPath(conversationId: string): string {
  return path.join(brainDir, conversationId, ".system_generated", "logs", "transcript.jsonl");
}
