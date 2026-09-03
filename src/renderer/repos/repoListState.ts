import type { PullRequestUpdate, SessionUpdate } from "../../shared/ipc";
import type { PrimarySessionListItem, RepoListItem, WorktreeListItem } from "../../shared/metadata";
import type { GitHubPullRequest, TerminalRuntimeId } from "../../shared/session";

export function findWorktree(
  repos: RepoListItem[],
  worktreeId: string | null,
): WorktreeListItem | null {
  const repo = findRepoForWorktree(repos, worktreeId);
  if (!repo || !worktreeId) {
    return null;
  }
  if (repo.mainWorktree.worktreeId === worktreeId) {
    return repo.mainWorktree;
  }
  return repo.taskWorktrees.find((entry) => entry.worktreeId === worktreeId) ?? null;
}

function findRepoForWorktree(
  repos: RepoListItem[],
  worktreeId: string | null,
): RepoListItem | null {
  if (!worktreeId) {
    return null;
  }
  for (const repo of repos) {
    if (repo.mainWorktree.worktreeId === worktreeId) {
      return repo;
    }
    if (repo.taskWorktrees.some((entry) => entry.worktreeId === worktreeId)) {
      return repo;
    }
  }
  return null;
}

// 並び替え直後の一覧。書き込みの結果が push で戻るまで、ドロップした並びを描き続ける。
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

// 並び替え直後の一覧。worktree をまたがないので、対象 worktree の primary session だけを
// 並べ替える。
export function sortPrimarySessionsByKeys(
  repos: RepoListItem[],
  worktreeId: string,
  agentSessionKeys: string[],
): RepoListItem[] {
  const orderByKey = new Map(agentSessionKeys.map((key, index) => [key, index]));
  const toOrder = (session: PrimarySessionListItem): number =>
    (session.agentSessionKey === null ? undefined : orderByKey.get(session.agentSessionKey)) ??
    agentSessionKeys.length;
  return repos.map((repo) => {
    if (!repo.taskWorktrees.some((worktree) => worktree.worktreeId === worktreeId)) {
      return repo;
    }
    const taskWorktrees = repo.taskWorktrees.map((worktree) =>
      worktree.worktreeId === worktreeId
        ? {
            ...worktree,
            primarySessions: [...worktree.primarySessions].sort((a, b) => toOrder(a) - toOrder(b)),
          }
        : worktree,
    );
    return { ...repo, taskWorktrees };
  });
}

// keep-alive の単位は worktree (shell) であって session ではない。preview 選択・
// ExplorerPanel のタブ・Files の展開・検索語はすべて worktree に紐づく情報で session の
// 有無に依存しないため、「一度訪れた worktree」は app 起動中ずっと生かす。
// 表示中 runtime の生死は WorktreeView 側で props (activeTerminalRuntimeIds) から
// 別途判定するので、ここでは session の active/inactive を条件にしない。
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

// メインプロセスから push されたセッション更新を、対応する primary または suggested
// session に merge する。
export function applySessionUpdate(
  repos: RepoListItem[],
  terminalRuntimeId: TerminalRuntimeId,
  update: SessionUpdate,
): RepoListItem[] {
  let changed = false;
  const next = repos.map((repo) => {
    let repoChanged = false;
    const taskWorktrees = repo.taskWorktrees.map((worktree) => {
      let primarySessionsChanged = false;
      const primarySessions = worktree.primarySessions.map((session) => {
        if (session.activeTerminalRuntimeId !== terminalRuntimeId) {
          return session;
        }
        primarySessionsChanged = true;
        return { ...session, ...update };
      });
      let suggestedSessionsChanged = false;
      const suggestedSessions = worktree.suggestedSessions.map((session) => {
        if (session.activeTerminalRuntimeId !== terminalRuntimeId) {
          return session;
        }
        suggestedSessionsChanged = true;
        return { ...session, ...update };
      });

      if (!primarySessionsChanged && !suggestedSessionsChanged) {
        return worktree;
      }

      changed = true;
      repoChanged = true;
      return {
        ...worktree,
        primarySessions: primarySessionsChanged ? primarySessions : worktree.primarySessions,
        suggestedSessions: suggestedSessionsChanged
          ? suggestedSessions
          : worktree.suggestedSessions,
      };
    });
    return repoChanged ? { ...repo, taskWorktrees } : repo;
  });
  return changed ? next : repos;
}

// メインプロセスの PR ポーリングから push された PR 情報を該当 worktree に merge する。
// フォーカス直後は変化のない全量 push が来るので、値が同じ項目はオブジェクトを
// 差し替えず、何も変わらなければ prev をそのまま返して再描画を避ける。
export function applyPullRequestUpdates(
  repos: RepoListItem[],
  updates: PullRequestUpdate[],
): RepoListItem[] {
  const pullRequestsByWorktreeId = new Map(
    updates.map((update) => [update.worktreeId, update.pullRequest]),
  );
  let changed = false;
  const next = repos.map((repo) => {
    const taskWorktrees = repo.taskWorktrees.map((worktree) => {
      if (!pullRequestsByWorktreeId.has(worktree.worktreeId)) {
        return worktree;
      }
      const pullRequest = pullRequestsByWorktreeId.get(worktree.worktreeId) ?? null;
      if (samePullRequest(worktree.githubPullRequest ?? null, pullRequest)) {
        return worktree;
      }
      changed = true;
      return { ...worktree, githubPullRequest: pullRequest };
    });
    return taskWorktrees.some((worktree, i) => worktree !== repo.taskWorktrees[i])
      ? { ...repo, taskWorktrees }
      : repo;
  });
  return changed ? next : repos;
}

export function samePullRequest(a: GitHubPullRequest | null, b: GitHubPullRequest | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.prNumber === b.prNumber &&
    a.state === b.state &&
    a.isApproved === b.isApproved &&
    a.url === b.url
  );
}
