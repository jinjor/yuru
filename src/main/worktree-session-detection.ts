import path from "path";
import type { SessionProvider } from "../shared/session.js";

export interface WorktreeSessionHint {
  provider: SessionProvider;
  providerSessionId: string;
  worktreePath: string;
  worktreeRank: number;
}

function isSamePathOrChild(parentPath: string, maybeChildPath: string): boolean {
  const relativePath = path.relative(parentPath, maybeChildPath);
  return (
    relativePath === "" ||
    (!!relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

export function resolveContainingWorktreePath(
  cwd: string,
  worktreePaths: readonly string[],
): string | null {
  const resolvedCwd = path.resolve(cwd);
  const matches = worktreePaths
    .map((worktreePath) => ({
      original: worktreePath,
      resolved: path.resolve(worktreePath),
    }))
    .filter((worktree) => isSamePathOrChild(worktree.resolved, resolvedCwd))
    .sort((a, b) => b.resolved.length - a.resolved.length);

  return matches[0]?.original ?? null;
}

export function resolveMentionedWorktreePaths(
  content: string,
  worktreePaths: readonly string[],
): string[] {
  return worktreePaths
    .map((worktreePath) => ({
      original: worktreePath,
      resolved: path.resolve(worktreePath),
    }))
    .sort((a, b) => b.resolved.length - a.resolved.length)
    .flatMap((worktree) => (hasPathMention(content, worktree.resolved) ? [worktree.original] : []));
}

function hasPathMention(content: string, resolvedPath: string): boolean {
  let index = content.indexOf(resolvedPath);
  while (index !== -1) {
    const before = content[index - 1];
    const after = content[index + resolvedPath.length];
    if (isPathMentionStartBoundary(before) && isPathMentionEndBoundary(after)) {
      return true;
    }
    index = content.indexOf(resolvedPath, index + 1);
  }
  return false;
}

function isPathMentionStartBoundary(char: string | undefined): boolean {
  return char === undefined || !isPathSegmentChar(char);
}

function isPathMentionEndBoundary(char: string | undefined): boolean {
  return char === undefined || char === path.sep || !isPathSegmentChar(char);
}

function isPathSegmentChar(char: string): boolean {
  return /[A-Za-z0-9._-]/.test(char);
}
