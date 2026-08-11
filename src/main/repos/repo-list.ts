import path from "path";
import type {
  RepoListItem,
  RepoMetadata,
  PrimarySessionListItem,
  SuggestedSessionListItem,
  TaskWorktreeMetadata,
  WorktreeListItem,
} from "../../shared/metadata.js";
import {
  toSessionKey,
  type AgentActivityState,
  type GitHubPullRequest,
  type TerminalRuntimeId,
  type SessionProvider,
  type SuggestedWorktreeSession,
} from "../../shared/session.js";
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
type LoadSuggestedSessions = (
  worktreePaths: readonly string[],
) => Promise<ReadonlyMap<string, readonly SuggestedWorktreeSession[]>>;
// PullRequestMonitor が最後に取得した PR を読むだけ (GitHub へは行かない)。
type GetGitHubPullRequest = (
  repoPath: string,
  branch: string,
  headSha: string,
) => GitHubPullRequest | null | undefined;

interface WorktreeListSource {
  path: string;
  branch: string | null;
  headSha: string | null;
  headCommittedAt?: number;
}

interface ActiveTerminalRuntimeWorktreeSession {
  provider: SessionProvider;
  terminalRuntimeId: TerminalRuntimeId;
}

interface RepoListSource {
  repo: RepoMetadata;
  taskWorktreeMetadataByPath: Map<string, TaskWorktreeMetadata>;
  gitWorktrees: readonly WorktreeInfo[];
  mainWorktree: WorktreeListSource;
}

export async function loadRepoList(
  terminalRuntimeIdsBySessionKey?: ReadonlyMap<string, TerminalRuntimeId>,
  listGitWorktrees: ListWorktrees = listWorktrees,
  primarySessionPreviewsByKey?: ReadonlyMap<string, string>,
  loadSuggestedSessions?: LoadSuggestedSessions,
  activeTerminalRuntimesByWorktreePath?: ReadonlyMap<string, ActiveTerminalRuntimeWorktreeSession>,
  getGitHubPullRequest?: GetGitHubPullRequest,
  agentActivityStatesByTerminalRuntimeId?: ReadonlyMap<TerminalRuntimeId, AgentActivityState>,
  allTerminalRuntimeIdsByWorktreePath?: ReadonlyMap<string, readonly string[]>,
): Promise<RepoListItem[]> {
  const metadata = loadMetadata();
  const repoEntries = (
    await Promise.all(
      metadata.repos.map(async (repo) => {
        const taskWorktreeMetadataByPath = new Map(
          metadata.taskWorktrees
            .filter((taskWorktree) => taskWorktree.repoId === repo.id)
            .map((taskWorktree) => [toWorktreePathKey(taskWorktree.worktreePath), taskWorktree]),
        );
        if (!(await isSupportedGitRepo(repo.repoPath))) {
          return null;
        }
        const gitWorktrees = await listGitWorktrees(repo.repoPath);
        const mainWorktree = await loadMainWorktree(repo.repoPath);
        return { repo, taskWorktreeMetadataByPath, gitWorktrees, mainWorktree };
      }),
    )
  ).filter((entry): entry is RepoListSource => entry !== null);
  const worktreePaths = repoEntries.flatMap((entry) =>
    entry.gitWorktrees.map((gitWorktree) => gitWorktree.path),
  );
  const suggestedSessionsByWorktreePath = loadSuggestedSessions
    ? await loadSuggestedSessions(worktreePaths)
    : undefined;

  return repoEntries.map(({ repo, taskWorktreeMetadataByPath, gitWorktrees, mainWorktree }) => {
    const taskWorktrees = gitWorktrees.map((gitWorktree) =>
      toWorktreeListItem(
        repo.id,
        gitWorktree,
        taskWorktreeMetadataByPath.get(toWorktreePathKey(gitWorktree.path)),
        terminalRuntimeIdsBySessionKey,
        activeTerminalRuntimesByWorktreePath,
        primarySessionPreviewsByKey,
        suggestedSessionsByWorktreePath?.get(gitWorktree.path) ?? [],
        gitWorktree.branch
          ? getGitHubPullRequest?.(repo.repoPath, gitWorktree.branch, gitWorktree.headSha)
          : undefined,
        agentActivityStatesByTerminalRuntimeId,
        allTerminalRuntimeIdsByWorktreePath,
      ),
    );
    return {
      ...repo,
      mainWorktree: toWorktreeListItem(
        repo.id,
        mainWorktree,
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        allTerminalRuntimeIdsByWorktreePath,
        true,
      ),
      taskWorktrees,
    };
  });
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
  metadataEntry: TaskWorktreeMetadata | undefined,
  terminalRuntimeIdsBySessionKey: ReadonlyMap<string, TerminalRuntimeId> | undefined,
  activeTerminalRuntimesByWorktreePath:
    | ReadonlyMap<string, ActiveTerminalRuntimeWorktreeSession>
    | undefined,
  primarySessionPreviewsByKey: ReadonlyMap<string, string> | undefined,
  suggestedSessions: readonly SuggestedWorktreeSession[],
  githubPullRequest: GitHubPullRequest | null | undefined,
  agentActivityStatesByTerminalRuntimeId:
    | ReadonlyMap<TerminalRuntimeId, AgentActivityState>
    | undefined,
  allTerminalRuntimeIdsByWorktreePath: ReadonlyMap<string, readonly string[]> | undefined,
  isMainWorktree = false,
): WorktreeListItem {
  const worktreePath = gitWorktree.path;
  const worktreeId = toWorktreeId(repoId, worktreePath);
  const primarySessions = metadataEntry?.primarySessions ?? [];
  const primarySessionItems = primarySessions.map((primarySession): PrimarySessionListItem => {
    const agentSessionKey = toSessionKey(primarySession.provider, primarySession.agentSessionId);
    const activeTerminalRuntimeId = terminalRuntimeIdsBySessionKey?.get(agentSessionKey) ?? null;
    return {
      provider: primarySession.provider,
      agentSessionKey,
      activeTerminalRuntimeId,
      state: activeTerminalRuntimeId ? "active" : "inactive",
      activityState: activeTerminalRuntimeId
        ? (agentActivityStatesByTerminalRuntimeId?.get(activeTerminalRuntimeId) ?? "waiting")
        : "waiting",
      preview: primarySessionPreviewsByKey?.get(agentSessionKey) ?? "",
    };
  });
  const primarySessionKeys = new Set(
    primarySessions.map((session) => toSessionKey(session.provider, session.agentSessionId)),
  );
  const activeTerminalRuntime =
    primarySessions.length === 0
      ? (activeTerminalRuntimesByWorktreePath?.get(toWorktreePathKey(worktreePath)) ?? null)
      : null;
  const activeTerminalActivityState = activeTerminalRuntime
    ? (agentActivityStatesByTerminalRuntimeId?.get(activeTerminalRuntime.terminalRuntimeId) ??
      "waiting")
    : "waiting";
  const suggestedSessionItems = toSuggestedSessionListItems(
    suggestedSessions,
    primarySessionKeys,
    terminalRuntimeIdsBySessionKey,
    primarySessionPreviewsByKey,
    agentActivityStatesByTerminalRuntimeId,
  );
  if (activeTerminalRuntime) {
    primarySessionItems.push({
      provider: activeTerminalRuntime.provider,
      agentSessionKey: null,
      activeTerminalRuntimeId: activeTerminalRuntime.terminalRuntimeId,
      state: "active",
      activityState: activeTerminalActivityState,
      preview: "",
    });
  }

  const item: WorktreeListItem = {
    worktreeId,
    worktreePath,
    name: path.basename(worktreePath),
    branch: gitWorktree.branch,
    headSha: gitWorktree.headSha,
    headCommittedAt: gitWorktree.headCommittedAt,
    primarySessions: primarySessionItems,
    suggestedSessions: suggestedSessionItems,
    activeTerminalRuntimeIds: [
      ...(allTerminalRuntimeIdsByWorktreePath?.get(toWorktreePathKey(worktreePath)) ?? []),
    ],
  };

  if (githubPullRequest !== undefined) {
    item.githubPullRequest = githubPullRequest;
  }
  if (isMainWorktree) {
    item.isMainWorktree = true;
  }

  return item;
}

function toSuggestedSessionListItems(
  suggestedSessions: readonly SuggestedWorktreeSession[],
  excludedSessionKeys: ReadonlySet<string>,
  terminalRuntimeIdsBySessionKey: ReadonlyMap<string, TerminalRuntimeId> | undefined,
  primarySessionPreviewsByKey: ReadonlyMap<string, string> | undefined,
  agentActivityStatesByTerminalRuntimeId:
    | ReadonlyMap<TerminalRuntimeId, AgentActivityState>
    | undefined,
): SuggestedSessionListItem[] {
  return suggestedSessions.flatMap((session) => {
    const agentSessionKey = toSessionKey(session.provider, session.agentSessionId);
    if (excludedSessionKeys.has(agentSessionKey)) {
      return [];
    }
    const activeTerminalRuntimeId = terminalRuntimeIdsBySessionKey?.get(agentSessionKey) ?? null;
    const item: SuggestedSessionListItem = {
      provider: session.provider,
      agentSessionKey,
      activeTerminalRuntimeId,
      state: activeTerminalRuntimeId ? "active" : "inactive",
      activityState: activeTerminalRuntimeId
        ? (agentActivityStatesByTerminalRuntimeId?.get(activeTerminalRuntimeId) ?? "waiting")
        : "waiting",
      preview: primarySessionPreviewsByKey?.get(agentSessionKey) ?? "",
      timestamp: session.timestamp ?? 0,
    };
    return [item];
  });
}
