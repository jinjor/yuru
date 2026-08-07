import type { PullRequestUpdate, SessionUpdate } from "../../shared/ipc";
import type { RepoListItem, WorktreeListItem } from "../../shared/metadata";
import type { GitHubPullRequest, TerminalRuntimeId } from "../../shared/session";

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
    const taskWorktree = repo.taskWorktrees.find((entry) => entry.worktreeId === worktreeId);
    if (taskWorktree) {
      return taskWorktree;
    }
  }
  return null;
}

// keep-alive の単位は worktree (shell) であって session ではない。preview 選択・
// ExplorerPanel のタブ・Files の展開・検索語はすべて worktree に紐づく情報で session の
// 有無に依存しないため、「一度訪れた worktree」は app 起動中ずっと生かす。
// 表示中 runtime の生死は SessionView 側で props (activeTerminalRuntimeIds) から
// 別途判定するので、ここでは session の active/inactive を条件にしない。
export function collectKeepAliveWorktrees(
  repos: RepoListItem[],
  selectedWorktreeId: string | null,
  visitedWorktreeIds: ReadonlySet<string>,
): WorktreeListItem[] {
  const worktrees: WorktreeListItem[] = [];
  const collectedWorktreeIds = new Set<string>();

  const collect = (worktree: WorktreeListItem): void => {
    if (collectedWorktreeIds.has(worktree.worktreeId)) {
      return;
    }
    collectedWorktreeIds.add(worktree.worktreeId);
    worktrees.push(worktree);
  };

  for (const repo of repos) {
    collect(repo.mainWorktree);
    for (const worktree of repo.taskWorktrees) {
      if (
        worktree.worktreeId === selectedWorktreeId ||
        visitedWorktreeIds.has(worktree.worktreeId)
      ) {
        collect(worktree);
      }
    }
  }

  return worktrees;
}

// メインプロセスから push されたセッション更新を、該当セッションを表示している項目に merge する。
export function applySessionUpdate(
  repos: RepoListItem[],
  terminalRuntimeId: TerminalRuntimeId,
  update: SessionUpdate,
): RepoListItem[] {
  let changed = false;
  const next = repos.map((repo) => {
    let repoChanged = false;
    const taskWorktrees = repo.taskWorktrees.map((worktree) => {
      const primarySession = worktree.primarySession;
      const primarySessionMatches = primarySession?.activeTerminalRuntimeId === terminalRuntimeId;
      let suggestedSessionsChanged = false;
      const suggestedSessions = worktree.suggestedSessions.map((session) => {
        if (session.activeTerminalRuntimeId !== terminalRuntimeId) {
          return session;
        }
        suggestedSessionsChanged = true;
        return { ...session, ...update };
      });

      if (!primarySessionMatches && !suggestedSessionsChanged) {
        return worktree;
      }

      changed = true;
      repoChanged = true;
      return {
        ...worktree,
        primarySession: primarySessionMatches ? { ...primarySession, ...update } : primarySession,
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
