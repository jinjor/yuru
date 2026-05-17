import type { RepoMetadata } from "../shared/metadata.js";
import { listWorktrees, type WorktreeInfo } from "./git.js";
import { loadMetadata, saveMetadata } from "./metadata.js";
import { toWorktreePathKey } from "./worktree-identity.js";

type ListWorktrees = (repoPath: string) => Promise<readonly WorktreeInfo[]>;

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
