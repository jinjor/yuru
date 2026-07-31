import type { RepoMetadata } from "../shared/metadata.js";
import { isSupportedGitRepo, listWorktrees, type WorktreeInfo } from "./git.js";
import { loadRepos } from "./metadata.js";
import { toWorktreePathKey } from "./worktree-identity.js";

type ListWorktrees = (repoPath: string) => Promise<readonly WorktreeInfo[]>;
type IsSupportedGitRepo = (repoPath: string) => Promise<boolean>;

export async function findRepoByWorktreePath(
  worktreePath: string,
  repos: readonly RepoMetadata[] = loadRepos(),
  listGitWorktrees: ListWorktrees = listWorktrees,
  isSupportedRepo: IsSupportedGitRepo = isSupportedGitRepo,
): Promise<RepoMetadata | null> {
  const worktreePathKey = toWorktreePathKey(worktreePath);
  for (const repo of repos) {
    if (!(await isSupportedRepo(repo.repoPath))) {
      continue;
    }
    const worktrees = await listGitWorktrees(repo.repoPath);
    if (worktrees.some((worktree) => toWorktreePathKey(worktree.path) === worktreePathKey)) {
      return repo;
    }
  }
  return null;
}
