import path from "path";
import type { SessionProvider } from "../../shared/session.js";
import { isPathWithin } from "../worktree-identity.js";

export interface WorktreeSessionHint {
  provider: SessionProvider;
  providerSessionId: string;
  worktreePath: string;
  worktreeRank: number;
}

export function resolveContainingWorktreePath(
  cwd: string,
  worktreePaths: readonly string[],
): string | null {
  const matches = worktreePaths
    .map((worktreePath) => ({
      original: worktreePath,
      resolved: path.resolve(worktreePath),
    }))
    .filter((worktree) => isPathWithin(worktree.resolved, cwd))
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
