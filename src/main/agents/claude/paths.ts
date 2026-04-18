import os from "os";
import path from "path";

const claudeDir = path.join(os.homedir(), ".claude");
const sessionsDir = path.join(claudeDir, "sessions");
const historyPath = path.join(claudeDir, "history.jsonl");
const worktreeSegment = ".claude/worktrees";

export function claudeHistoryPath(): string {
  return historyPath;
}

export function claudeWorktreeCwd(repoPath: string, worktreeName: string): string {
  return path.join(repoPath, worktreeSegment, worktreeName);
}

export function pidFilePath(pid: number): string {
  return path.join(sessionsDir, `${pid}.json`);
}

export function claudeBranchName(worktreeName: string): string {
  return `worktree-${worktreeName}`;
}
