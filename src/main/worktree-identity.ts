import path from "path";

export function toWorktreeId(repoId: string, worktreePath: string): string {
  return `worktree:${repoId}:${worktreePath}`;
}

export function toWorktreePathKey(worktreePath: string): string {
  return path.resolve(worktreePath);
}

// candidatePath が parentPath そのもの、または parentPath 配下にあるかを判定する。
export function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return (
    relativePath === "" ||
    (!!relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}
