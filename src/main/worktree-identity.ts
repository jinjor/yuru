import path from "path";

export function toWorktreeId(repoId: string, worktreePath: string): string {
  return `worktree:${repoId}:${worktreePath}`;
}

// toWorktreeId の逆。worktree path 側はコロンを含みうるので、repoId だけを取り出す。
export function toRepoId(worktreeId: string): string | null {
  return /^worktree:([^:]+):/.exec(worktreeId)?.[1] ?? null;
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
