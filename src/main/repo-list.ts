import path from "path";
import type {
  RepoListItem,
  RepoMetadata,
  SuggestedSessionListItem,
  TaskWorktreeListItem,
  TaskWorktreeMetadata,
} from "../shared/metadata.js";
import {
  toSessionKey,
  type GitHubPullRequest,
  type RuntimeSessionId,
  type SessionProvider,
  type SuggestedWorktreeSession,
} from "../shared/session.js";
import { listWorktrees, type WorktreeInfo } from "./git.js";
import { loadMetadata } from "./metadata.js";
import { toWorktreeId, toWorktreePathKey } from "./worktree-identity.js";

type ListWorktrees = (repoPath: string) => Promise<readonly WorktreeInfo[]>;
type LoadSuggestedSessions = (
  worktreePaths: readonly string[],
) => Promise<ReadonlyMap<string, readonly SuggestedWorktreeSession[]>>;
type LoadGitHubPullRequest = (
  repoPath: string,
  branch: string | null,
) => Promise<GitHubPullRequest | null>;

interface ActiveRuntimeWorktreeSession {
  provider: SessionProvider;
  runtimeSessionId: RuntimeSessionId;
}

export async function loadRepoList(
  activeRuntimeSessionIdsByKey?: ReadonlyMap<string, RuntimeSessionId>,
  listGitWorktrees: ListWorktrees = listWorktrees,
  primarySessionPreviewsByKey?: ReadonlyMap<string, string>,
  loadSuggestedSessions?: LoadSuggestedSessions,
  activeRuntimeSessionsByWorktreePath?: ReadonlyMap<string, ActiveRuntimeWorktreeSession>,
  loadGitHubPullRequest?: LoadGitHubPullRequest,
): Promise<RepoListItem[]> {
  const metadata = loadMetadata();
  const repoEntries = await Promise.all(
    metadata.repos.map(async (repo) => {
      // TODO: repo の存在確認。存在しない repo は返さない。
      const metadataByPath = new Map(
        metadata.taskWorktrees
          .filter((taskWorktree) => taskWorktree.repoId === repo.id)
          .map((taskWorktree) => [toWorktreePathKey(taskWorktree.worktreePath), taskWorktree]),
      );
      const gitWorktrees = await loadGitWorktrees(repo.repoPath, listGitWorktrees);
      return { repo, metadataByPath, gitWorktrees };
    }),
  );
  const worktreePaths = repoEntries.flatMap((entry) =>
    entry.gitWorktrees.map((gitWorktree) => gitWorktree.path),
  );
  const suggestedSessionsByWorktreePath = loadSuggestedSessions
    ? await loadSuggestedSessions(worktreePaths)
    : undefined;
  const githubPullRequestsByWorktreePath = loadGitHubPullRequest
    ? await loadGitHubPullRequests(repoEntries, loadGitHubPullRequest)
    : undefined;

  return repoEntries.map(({ repo, metadataByPath, gitWorktrees }) => {
    const taskWorktrees = gitWorktrees.map((gitWorktree) =>
      toTaskWorktreeListItem(
        repo.id,
        gitWorktree,
        metadataByPath.get(toWorktreePathKey(gitWorktree.path)),
        activeRuntimeSessionIdsByKey,
        activeRuntimeSessionsByWorktreePath,
        primarySessionPreviewsByKey,
        suggestedSessionsByWorktreePath?.get(gitWorktree.path) ?? [],
        githubPullRequestsByWorktreePath?.get(gitWorktree.path),
      ),
    );

    return {
      ...repo,
      taskWorktrees,
    };
  });
}

async function loadGitWorktrees(
  repoPath: string,
  listGitWorktrees: ListWorktrees,
): Promise<readonly WorktreeInfo[]> {
  try {
    return await listGitWorktrees(repoPath);
  } catch {
    return [];
  }
}

async function loadGitHubPullRequests(
  repoEntries: readonly {
    repo: RepoMetadata;
    gitWorktrees: readonly WorktreeInfo[];
  }[],
  loadGitHubPullRequest: LoadGitHubPullRequest,
): Promise<Map<string, GitHubPullRequest | null>> {
  const entries = await Promise.all(
    repoEntries.flatMap(({ repo, gitWorktrees }) =>
      gitWorktrees.map(
        async (gitWorktree) =>
          [
            gitWorktree.path,
            await loadGitHubPullRequest(repo.repoPath, gitWorktree.branch),
          ] as const,
      ),
    ),
  );
  return new Map(entries);
}

function toTaskWorktreeListItem(
  repoId: string,
  gitWorktree: WorktreeInfo,
  metadataEntry: TaskWorktreeMetadata | undefined,
  activeRuntimeSessionIdsByKey: ReadonlyMap<string, RuntimeSessionId> | undefined,
  activeRuntimeSessionsByWorktreePath:
    | ReadonlyMap<string, ActiveRuntimeWorktreeSession>
    | undefined,
  primarySessionPreviewsByKey: ReadonlyMap<string, string> | undefined,
  suggestedSessions: readonly SuggestedWorktreeSession[],
  githubPullRequest: GitHubPullRequest | null | undefined,
): TaskWorktreeListItem {
  const worktreePath = gitWorktree.path;
  const worktreeId = toWorktreeId(repoId, worktreePath);
  const primarySession = metadataEntry?.primarySession;
  const primarySessionKey = primarySession
    ? toSessionKey(primarySession.provider, primarySession.providerSessionId)
    : null;
  const activeRuntimeSessionId = primarySessionKey
    ? (activeRuntimeSessionIdsByKey?.get(primarySessionKey) ?? null)
    : null;
  const activeRuntimeSession = primarySession
    ? null
    : (activeRuntimeSessionsByWorktreePath?.get(toWorktreePathKey(worktreePath)) ?? null);
  const suggestedSessionItems = toSuggestedSessionListItems(
    suggestedSessions,
    new Set([primarySessionKey].filter((key) => key !== null)),
    activeRuntimeSessionIdsByKey,
    primarySessionPreviewsByKey,
  );

  const item: TaskWorktreeListItem = {
    worktreeId,
    worktreePath,
    name: path.basename(worktreePath),
    branch: gitWorktree.branch,
    headSha: gitWorktree.headSha,
    primarySession:
      primarySession && primarySessionKey
        ? {
            provider: primarySession.provider,
            providerSessionKey: primarySessionKey,
            activeRuntimeSessionId,
            state: activeRuntimeSessionId ? "active" : "inactive",
            preview: primarySessionPreviewsByKey?.get(primarySessionKey) ?? "",
          }
        : activeRuntimeSession
          ? {
              provider: activeRuntimeSession.provider,
              providerSessionKey: null,
              activeRuntimeSessionId: activeRuntimeSession.runtimeSessionId,
              state: "active",
              preview: "",
            }
          : undefined,
    suggestedSessions: suggestedSessionItems,
  };

  if (githubPullRequest !== undefined) {
    item.githubPullRequest = githubPullRequest;
  }

  return item;
}

function toSuggestedSessionListItems(
  suggestedSessions: readonly SuggestedWorktreeSession[],
  excludedSessionKeys: ReadonlySet<string>,
  activeRuntimeSessionIdsByKey: ReadonlyMap<string, RuntimeSessionId> | undefined,
  primarySessionPreviewsByKey: ReadonlyMap<string, string> | undefined,
): SuggestedSessionListItem[] {
  return suggestedSessions.flatMap((session) => {
    const providerSessionKey = toSessionKey(session.provider, session.providerSessionId);
    if (excludedSessionKeys.has(providerSessionKey)) {
      return [];
    }
    const activeRuntimeSessionId = activeRuntimeSessionIdsByKey?.get(providerSessionKey) ?? null;
    return [
      {
        provider: session.provider,
        providerSessionKey,
        activeRuntimeSessionId,
        state: activeRuntimeSessionId ? "active" : "inactive",
        preview: primarySessionPreviewsByKey?.get(providerSessionKey) ?? "",
        timestamp: session.timestamp ?? 0,
      },
    ];
  });
}
