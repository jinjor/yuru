import os from "os";
import path from "path";

const codexDir = path.join(os.homedir(), ".codex");
const codexHistoryPath = path.join(codexDir, "history.jsonl");
const codexSessionsDir = path.join(codexDir, "sessions");
const worktreeSegment = ".yuru/worktrees";

export function getCodexHistoryPath(): string {
  return codexHistoryPath;
}

export function getCodexSessionsDir(): string {
  return codexSessionsDir;
}

export function codexWorktreeCwd(repoPath: string, worktreeName: string): string {
  return path.join(repoPath, worktreeSegment, worktreeName);
}
