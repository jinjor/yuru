import type { RepoMetadata } from "../../shared/metadata.js";
import { isSupportedGitRepo } from "../git/repo.js";
import { listWorktrees, type WorktreeInfo } from "../git/worktree.js";
import { loadMetadata, saveMetadata } from "./metadata.js";
import { toWorktreePathKey } from "../worktree-identity.js";

type ListWorktrees = (repoPath: string) => Promise<readonly WorktreeInfo[]>;
type IsSupportedGitRepo = (repoPath: string) => Promise<boolean>;

export interface RemovedRepo {
  repoId: string;
  repoPath: string;
}

// repoPath が Git repository でなくなった repo entry を消す。その repo の task worktree
// record も一緒に消す (repo が消えると誰も読まない死んだデータになるため)。
export async function cleanupBrokenRepos(
  isSupportedRepo: IsSupportedGitRepo = isSupportedGitRepo,
): Promise<RemovedRepo[]> {
  const metadata = loadMetadata();
  const removedRepos: RemovedRepo[] = [];

  for (const repo of metadata.repos) {
    if (!(await isSupportedRepo(repo.repoPath))) {
      removedRepos.push({ repoId: repo.id, repoPath: repo.repoPath });
    }
  }
  if (removedRepos.length === 0) {
    return removedRepos;
  }

  const removedRepoIds = new Set(removedRepos.map((repo) => repo.repoId));
  metadata.repos = metadata.repos.filter((repo) => !removedRepoIds.has(repo.id));
  metadata.taskWorktrees = metadata.taskWorktrees.filter(
    (entry) => !removedRepoIds.has(entry.repoId),
  );
  saveMetadata(metadata);
  return removedRepos;
}

export interface CleanupStaleTaskWorktreesResult {
  removedTaskWorktreeCount: number;
  skippedRepos: CleanupSkippedRepo[];
}

export interface CleanupSkippedRepo {
  repoId: string;
  repoPath: string;
  error: unknown;
}

export async function cleanupStaleTaskWorktrees(
  listGitWorktrees: ListWorktrees = listWorktrees,
): Promise<CleanupStaleTaskWorktreesResult> {
  const metadata = loadMetadata();
  const listedPathKeysByRepoId = new Map<string, Set<string>>();
  const skippedRepos: CleanupSkippedRepo[] = [];

  for (const repo of metadata.repos) {
    try {
      const gitWorktrees = await listGitWorktrees(repo.repoPath);
      listedPathKeysByRepoId.set(repo.id, toWorktreePathKeySet(gitWorktrees));
    } catch (error) {
      skippedRepos.push(toCleanupSkippedRepo(repo, error));
      continue;
    }
  }

  const nextTaskWorktrees = metadata.taskWorktrees.filter((entry) => {
    const listedPathKeys = listedPathKeysByRepoId.get(entry.repoId);
    if (!listedPathKeys) {
      return true;
    }
    return listedPathKeys.has(toWorktreePathKey(entry.worktreePath));
  });
  const removedTaskWorktreeCount = metadata.taskWorktrees.length - nextTaskWorktrees.length;
  if (nextTaskWorktrees.length === metadata.taskWorktrees.length) {
    return { removedTaskWorktreeCount, skippedRepos };
  }

  metadata.taskWorktrees = nextTaskWorktrees;
  saveMetadata(metadata);
  return { removedTaskWorktreeCount, skippedRepos };
}

function toWorktreePathKeySet(gitWorktrees: readonly WorktreeInfo[]): Set<string> {
  return new Set(gitWorktrees.map((worktree) => toWorktreePathKey(worktree.path)));
}

function toCleanupSkippedRepo(repo: RepoMetadata, error: unknown): CleanupSkippedRepo {
  return { repoId: repo.id, repoPath: repo.repoPath, error };
}
