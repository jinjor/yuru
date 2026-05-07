import path from "path";
import type { SessionProvider } from "../shared/session.js";

export interface WorktreeSessionHint {
  provider: SessionProvider;
  providerSessionId: string;
  worktreePath: string;
  source: string;
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
