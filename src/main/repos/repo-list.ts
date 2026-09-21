import path from "path";
import type {
  RepoListItem,
  RepoMetadata,
  WorktreeListItem,
  YuruMetadata,
} from "../../shared/metadata.js";
import {
  getCurrentBranch,
  getHeadCommittedAt,
  getHeadSha,
  isSupportedGitRepo,
} from "../git/repo.js";
import { listWorktrees, type WorktreeInfo } from "../git/worktree.js";
import { loadMetadata } from "./metadata.js";
import { toWorktreeId, toWorktreePathKey } from "../worktree-identity.js";

type ListWorktrees = (repoPath: string) => Promise<readonly WorktreeInfo[]>;
type GetGitHubRepoSlug = (repoPath: string) => Promise<string | null>;

interface WorktreeListSource {
  path: string;
  branch: string | null;
  headSha: string | null;
  headCommittedAt?: number;
}

interface RepoListSource {
  repo: RepoMetadata;
  githubRepoSlug: string | null;
  gitWorktrees: readonly WorktreeInfo[];
  mainWorktree: WorktreeListSource;
}

// 一覧は repo と worktree の顔ぶれ・並び・Git の位置だけを組み立てる。session や PR の
// ような worktree ごとの表示状態は、カードと WorktreeView が worktreeId で個別に取る。
export async function loadRepoList(
  listGitWorktrees: ListWorktrees = listWorktrees,
  metadata: YuruMetadata = loadMetadata(),
  getGitHubRepoSlug?: GetGitHubRepoSlug,
): Promise<RepoListItem[]> {
  const repoEntries = (
    await Promise.all(
      metadata.repos.map(async (repo) => {
        if (!(await isSupportedGitRepo(repo.repoPath))) {
          return null;
        }
        const [gitWorktrees, mainWorktree, githubRepoSlug] = await Promise.all([
          listGitWorktrees(repo.repoPath),
          loadMainWorktree(repo.repoPath),
          getGitHubRepoSlug?.(repo.repoPath) ?? null,
        ]);
        return { repo, githubRepoSlug, gitWorktrees, mainWorktree };
      }),
    )
  ).filter((entry): entry is RepoListSource => entry !== null);

  return repoEntries.map((entry) => {
    const { repo, githubRepoSlug, gitWorktrees, mainWorktree } = entry;
    return {
      id: repo.id,
      repoPath: repo.repoPath,
      ...(githubRepoSlug ? { githubRepoSlug } : {}),
      mainWorktree: toWorktreeListItem(repo.id, mainWorktree, true),
      taskWorktrees: sortWorktreesByOrder(gitWorktrees, repo.worktreeOrder).map((gitWorktree) =>
        toWorktreeListItem(repo.id, gitWorktree),
      ),
    };
  });
}

// 表示順はユーザーが並び替えた worktreeOrder の順。そこに無い worktree (新しく作った
// ものや git で直接掘ったもの) は、渡された作成日時順のまま末尾に並ぶ。worktreeOrder に
// 残った実在しない path はここで自然に落ちる。
export function sortWorktreesByOrder(
  gitWorktrees: readonly WorktreeInfo[],
  worktreeOrder: readonly string[] | undefined,
): WorktreeInfo[] {
  if (!worktreeOrder) {
    return [...gitWorktrees];
  }
  const orderByPathKey = new Map(
    worktreeOrder.map((worktreePath, index) => [toWorktreePathKey(worktreePath), index]),
  );
  const toOrder = (worktree: WorktreeInfo): number =>
    orderByPathKey.get(toWorktreePathKey(worktree.path)) ?? worktreeOrder.length;
  return gitWorktrees
    .map((worktree, index) => ({ worktree, index }))
    .sort((a, b) => toOrder(a.worktree) - toOrder(b.worktree) || a.index - b.index)
    .map((entry) => entry.worktree);
}

async function loadMainWorktree(repoPath: string): Promise<WorktreeListSource> {
  const [branch, headSha, headCommittedAt] = await Promise.all([
    getCurrentBranch(repoPath),
    getHeadSha(repoPath),
    getHeadCommittedAt(repoPath),
  ]);
  return {
    path: repoPath,
    branch,
    headSha,
    headCommittedAt: headCommittedAt ?? undefined,
  };
}

function toWorktreeListItem(
  repoId: string,
  gitWorktree: WorktreeListSource,
  isMainWorktree = false,
): WorktreeListItem {
  const item: WorktreeListItem = {
    worktreeId: toWorktreeId(repoId, gitWorktree.path),
    worktreePath: gitWorktree.path,
    name: path.basename(gitWorktree.path),
    branch: gitWorktree.branch,
    headSha: gitWorktree.headSha,
    headCommittedAt: gitWorktree.headCommittedAt,
  };
  if (isMainWorktree) {
    item.isMainWorktree = true;
  }
  return item;
}
