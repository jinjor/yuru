import type { RepoListItem, WorktreeListItem } from "../../shared/metadata";

export function findWorktree(
  repos: RepoListItem[],
  worktreeId: string | null,
): WorktreeListItem | null {
  if (!worktreeId) {
    return null;
  }
  for (const repo of repos) {
    if (repo.mainWorktree.worktreeId === worktreeId) {
      return repo.mainWorktree;
    }
    const worktree = repo.taskWorktrees.find((entry) => entry.worktreeId === worktreeId);
    if (worktree) {
      return worktree;
    }
  }
  return null;
}

export function sortReposByIds(repos: RepoListItem[], repoIds: string[]): RepoListItem[] {
  const orderByRepoId = new Map(repoIds.map((repoId, index) => [repoId, index]));
  return [...repos].sort(
    (a, b) => (orderByRepoId.get(a.id) ?? repos.length) - (orderByRepoId.get(b.id) ?? repos.length),
  );
}

// 並び替え直後の一覧。repo をまたがないので、対象 repo の task worktree だけを並べ替える。
export function sortTaskWorktreesByPaths(
  repos: RepoListItem[],
  repoId: string,
  worktreePaths: string[],
): RepoListItem[] {
  const orderByPath = new Map(worktreePaths.map((worktreePath, index) => [worktreePath, index]));
  return repos.map((repo) => {
    if (repo.id !== repoId) {
      return repo;
    }
    const taskWorktrees = [...repo.taskWorktrees].sort(
      (a, b) =>
        (orderByPath.get(a.worktreePath) ?? worktreePaths.length) -
        (orderByPath.get(b.worktreePath) ?? worktreePaths.length),
    );
    return { ...repo, taskWorktrees };
  });
}

// keep-alive の単位は worktree (shell) であって session ではない。preview 選択・
// ExplorerPanel のタブ・Files の展開・検索語はすべて worktree に紐づく情報で session の
// 有無に依存しないため、「一度訪れた worktree」は app 起動中ずっと生かす。
export function collectKeepAliveWorktrees(
  repos: RepoListItem[],
  selectedWorktreeId: string | null,
  visitedWorktreeIds: ReadonlySet<string>,
): Array<{ repo: RepoListItem; worktree: WorktreeListItem }> {
  const worktrees: Array<{ repo: RepoListItem; worktree: WorktreeListItem }> = [];
  const collectedWorktreeIds = new Set<string>();

  const collect = (repo: RepoListItem, worktree: WorktreeListItem): void => {
    if (collectedWorktreeIds.has(worktree.worktreeId)) {
      return;
    }
    collectedWorktreeIds.add(worktree.worktreeId);
    worktrees.push({ repo, worktree });
  };

  for (const repo of repos) {
    collect(repo, repo.mainWorktree);
    for (const worktree of repo.taskWorktrees) {
      if (
        worktree.worktreeId === selectedWorktreeId ||
        visitedWorktreeIds.has(worktree.worktreeId)
      ) {
        collect(repo, worktree);
      }
    }
  }

  return worktrees;
}
