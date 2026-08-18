import { listWorktrees, type WorktreeInfo } from "../git/worktree.js";
import { toWorktreePathKey } from "../worktree-identity.js";
import { loadRepos, saveWorktreeOrder } from "./metadata.js";

type ListWorktrees = (repoPath: string) => Promise<readonly WorktreeInfo[]>;

// 並び替え後の、その repo の全 task worktree path を受け取り、今ある worktree と顔ぶれが
// 同じ時だけ並びを書く。違うなら、ドラッグ中に worktree が増減した古い一覧から来た並びで、
// 他の変更を巻き込んで上書きしてしまうため、何も書かずに false を返す。
export async function saveTaskWorktreeOrder(
  repoId: string,
  worktreePaths: readonly string[],
  listGitWorktrees: ListWorktrees = listWorktrees,
): Promise<boolean> {
  const repo = loadRepos().find((entry) => entry.id === repoId);
  if (!repo) {
    return false;
  }
  const gitWorktrees = await listGitWorktrees(repo.repoPath);
  if (!sameWorktreePathSet(gitWorktrees, worktreePaths)) {
    return false;
  }
  saveWorktreeOrder(repoId, worktreePaths);
  return true;
}

function sameWorktreePathSet(
  gitWorktrees: readonly WorktreeInfo[],
  worktreePaths: readonly string[],
): boolean {
  const gitPathKeys = new Set(gitWorktrees.map((worktree) => toWorktreePathKey(worktree.path)));
  const requestedPathKeys = new Set(worktreePaths.map(toWorktreePathKey));
  return (
    gitPathKeys.size === requestedPathKeys.size &&
    [...requestedPathKeys].every((pathKey) => gitPathKeys.has(pathKey))
  );
}
