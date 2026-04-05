import path from "path";
import os from "os";

// Base directories
export const claudeDir = path.join(os.homedir(), ".claude");
export const sessionsDir = path.join(claudeDir, "sessions");
export const historyPath = path.join(claudeDir, "history.jsonl");

// Worktree path conventions (matches Claude Code's `--worktree` behavior)
const WORKTREE_SEGMENT = ".claude/worktrees";

export function worktreeCwd(repoPath: string, worktreeName: string): string {
  return path.join(repoPath, WORKTREE_SEGMENT, worktreeName);
}

export function ccBranchName(worktreeName: string): string {
  return `worktree-${worktreeName}`;
}

/**
 * Extract the repo root path from a session's cwd.
 * If the cwd is inside a .claude/worktrees/ directory, returns the repo root.
 * Otherwise returns the cwd as-is.
 */
export function repoPathFromCwd(cwd: string): string {
  const marker = `/${WORKTREE_SEGMENT}/`;
  const idx = cwd.indexOf(marker);
  if (idx !== -1) {
    return cwd.substring(0, idx);
  }
  return cwd;
}


/** PID file path for a given process */
export function pidFilePath(pid: number): string {
  return path.join(sessionsDir, `${pid}.json`);
}
