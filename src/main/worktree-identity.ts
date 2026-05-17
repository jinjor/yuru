import path from "path";

export function toWorktreeId(repoId: string, worktreePath: string): string {
  return `worktree:${repoId}:${worktreePath}`;
}

export function toWorktreePathKey(worktreePath: string): string {
  return path.resolve(worktreePath);
}
