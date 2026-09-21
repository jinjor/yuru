import path from "path";

// worktree の識別子。path は必ず正規化してから埋めることで、同じ worktree を指す限り
// どこで作っても同じ ID になり、ID から取り出した path がそのまま突き合わせに使える。
export function toWorktreeId(repoId: string, worktreePath: string): string {
  return `worktree:${repoId}:${toWorktreePathKey(worktreePath)}`;
}

// toWorktreeId の逆。worktree path 側はコロンを含みうるので、repoId だけを取り出す。
export function toRepoId(worktreeId: string): string | null {
  return /^worktree:([^:]+):/.exec(worktreeId)?.[1] ?? null;
}

// toWorktreeId の逆。表示状態の取得のように、Git に問い合わせずに位置だけが要る所で使う。
// 実在の確認はしないので、worktree を操作する経路では findGitWorktree を使う。
export function toWorktreePath(worktreeId: string): string | null {
  return /^worktree:[^:]+:(.+)$/s.exec(worktreeId)?.[1] ?? null;
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
