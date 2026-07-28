import type { PullRequestUpdate } from "../shared/ipc.js";
import type { GitHubPullRequest } from "../shared/session.js";
import type { RepoMetadata } from "../shared/metadata.js";
import type { WorktreeInfo } from "./git.js";
import { recordAppWarning } from "./error-center.js";
import { toAppError } from "./errors.js";
import { toVisiblePullRequest, type FetchedPullRequest } from "./github.js";
import { toWorktreeId } from "./worktree-identity.js";

// ウィンドウがフォーカスされている間だけ動く PR ポーリング。tick は 10 秒ごとで、
// 生きた terminal runtime があるリポジトリは毎 tick、それ以外は 60 秒に 1 回取得する。
// 取得結果は前回 push した値と比較し、変わった worktree の分だけ renderer へ push する。
const TICK_INTERVAL_MS = 10_000;
const IDLE_REPO_FETCH_INTERVAL_MS = 60_000;

export interface PullRequestMonitorDeps {
  listRepos(): RepoMetadata[];
  listWorktrees(repoPath: string): Promise<readonly WorktreeInfo[]>;
  fetchPullRequests(
    repoPath: string,
    branches: readonly string[],
  ): Promise<ReadonlyMap<string, FetchedPullRequest | null> | null>;
  hasAliveTerminalRuntimeInRepo(repoPath: string): boolean;
  pullRequestsChanged(updates: PullRequestUpdate[]): void;
}

function samePullRequest(a: GitHubPullRequest | null, b: GitHubPullRequest | null): boolean {
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

export class PullRequestMonitor {
  private readonly deps: PullRequestMonitorDeps;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private readonly lastFetchedAtByRepoPath = new Map<string, number>();
  private readonly lastPushedByWorktreeId = new Map<string, GitHubPullRequest | null>();

  constructor(deps: PullRequestMonitorDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    // フォーカスが外れている間に renderer 側 (getRepos の読み込みやリロード) と
    // ズレている可能性があるので、push 済みの記憶を捨てて最初の tick で全量 push する。
    this.lastPushedByWorktreeId.clear();
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    // stop() や stop() -> start() は timer を差し替える。実行中の tick は await のたびに
    // 自分の timer が現役かを確かめ、停止済みなら以降の取得も push もやめる。
    const timer = this.timer;
    try {
      const updates: PullRequestUpdate[] = [];
      for (const repo of this.deps.listRepos()) {
        if (this.timer !== timer) {
          return;
        }
        const lastFetchedAt = this.lastFetchedAtByRepoPath.get(repo.repoPath) ?? 0;
        const fetchInterval = this.deps.hasAliveTerminalRuntimeInRepo(repo.repoPath)
          ? 0
          : IDLE_REPO_FETCH_INTERVAL_MS;
        if (Date.now() - lastFetchedAt < fetchInterval) {
          continue;
        }
        updates.push(...(await this.fetchRepoUpdates(repo)));
      }
      if (this.timer !== timer || updates.length === 0) {
        return;
      }
      // push できたものだけを「push 済み」として覚える。途中で停止した tick の
      // 取得結果を push 済み扱いにすると、renderer に届かないまま差分が消えてしまう。
      for (const update of updates) {
        this.lastPushedByWorktreeId.set(update.worktreeId, update.pullRequest);
      }
      this.deps.pullRequestsChanged(updates);
    } finally {
      this.ticking = false;
    }
  }

  private async fetchRepoUpdates(repo: RepoMetadata): Promise<PullRequestUpdate[]> {
    let worktrees: readonly WorktreeInfo[];
    try {
      worktrees = await this.deps.listWorktrees(repo.repoPath);
    } catch (error) {
      recordAppWarning(toAppError(error, { command: "git" }));
      return [];
    }

    const branchedWorktrees = worktrees.filter(
      (worktree): worktree is WorktreeInfo & { branch: string } => worktree.branch !== null,
    );
    this.lastFetchedAtByRepoPath.set(repo.repoPath, Date.now());
    const pullRequests = await this.deps.fetchPullRequests(
      repo.repoPath,
      branchedWorktrees.map((worktree) => worktree.branch),
    );
    if (!pullRequests) {
      return [];
    }

    const updates: PullRequestUpdate[] = [];
    for (const worktree of branchedWorktrees) {
      const worktreeId = toWorktreeId(repo.id, worktree.path);
      const pullRequest = toVisiblePullRequest(
        pullRequests.get(worktree.branch) ?? null,
        worktree.headSha,
      );
      const pushed = this.lastPushedByWorktreeId.get(worktreeId);
      if (
        this.lastPushedByWorktreeId.has(worktreeId) &&
        samePullRequest(pushed ?? null, pullRequest)
      ) {
        continue;
      }
      updates.push({ worktreeId, pullRequest });
    }
    return updates;
  }
}
