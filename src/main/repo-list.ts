import path from "path";
import type {
  RepoListItem,
  RepoMetadata,
  PrimarySessionListItem,
  SuggestedSessionListItem,
  TaskWorktreeMetadata,
  WorktreeListItem,
} from "../shared/metadata.js";
import {
  toSessionKey,
  type AgentActivityState,
  type GitHubPullRequest,
  type TerminalRuntimeId,
  type SessionProvider,
  type SuggestedWorktreeSession,
} from "../shared/session.js";
import {
  getCurrentBranch,
  getHeadSha,
  isSupportedGitRepo,
  listWorktrees,
  type WorktreeInfo,
} from "./git.js";
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

interface WorktreeListSource {
  path: string;
  branch: string | null;
  headSha: string | null;
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
  loadGitHubPullRequest?: LoadGitHubPullRequest,
  agentActivityStatesByTerminalRuntimeId?: ReadonlyMap<TerminalRuntimeId, AgentActivityState>,
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
  const githubPullRequestsByWorktreePath = loadGitHubPullRequest
    ? await loadGitHubPullRequests(repoEntries, loadGitHubPullRequest)
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
        githubPullRequestsByWorktreePath?.get(gitWorktree.path),
        agentActivityStatesByTerminalRuntimeId,
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
        githubPullRequestsByWorktreePath?.get(mainWorktree.path),
        undefined,
        true,
      ),
      taskWorktrees,
    };
  });
}

async function loadMainWorktree(repoPath: string): Promise<WorktreeListSource> {
  const [branch, headSha] = await Promise.all([getCurrentBranch(repoPath), getHeadSha(repoPath)]);
  return {
    path: repoPath,
    branch,
    headSha,
  };
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
  isMainWorktree = false,
): WorktreeListItem {
  const worktreePath = gitWorktree.path;
  const worktreeId = toWorktreeId(repoId, worktreePath);
  const primarySession = metadataEntry?.primarySession;
  const primarySessionKey = primarySession
    ? toSessionKey(primarySession.provider, primarySession.providerSessionId)
    : null;
  const activeTerminalRuntimeId = primarySessionKey
    ? (terminalRuntimeIdsBySessionKey?.get(primarySessionKey) ?? null)
    : null;
  const activeTerminalRuntime = primarySession
    ? null
    : (activeTerminalRuntimesByWorktreePath?.get(toWorktreePathKey(worktreePath)) ?? null);
  const primaryActivityState = activeTerminalRuntimeId
    ? (agentActivityStatesByTerminalRuntimeId?.get(activeTerminalRuntimeId) ?? "waiting")
    : "waiting";
  const activeTerminalActivityState = activeTerminalRuntime
    ? (agentActivityStatesByTerminalRuntimeId?.get(activeTerminalRuntime.terminalRuntimeId) ??
      "waiting")
    : "waiting";
  const suggestedSessionItems = toSuggestedSessionListItems(
    suggestedSessions,
    new Set([primarySessionKey].filter((key) => key !== null)),
    terminalRuntimeIdsBySessionKey,
    primarySessionPreviewsByKey,
    agentActivityStatesByTerminalRuntimeId,
  );
  const primarySessionItem: PrimarySessionListItem | undefined =
    primarySession && primarySessionKey
      ? {
          provider: primarySession.provider,
          providerSessionKey: primarySessionKey,
          activeTerminalRuntimeId,
          state: activeTerminalRuntimeId ? "active" : "inactive",
          activityState: primaryActivityState,
          preview: primarySessionPreviewsByKey?.get(primarySessionKey) ?? "",
        }
      : activeTerminalRuntime
        ? {
            provider: activeTerminalRuntime.provider,
            providerSessionKey: null,
            activeTerminalRuntimeId: activeTerminalRuntime.terminalRuntimeId,
            state: "active",
            activityState: activeTerminalActivityState,
            preview: "",
          }
        : undefined;

  const item: WorktreeListItem = {
    worktreeId,
    worktreePath,
    name: path.basename(worktreePath),
    branch: gitWorktree.branch,
    headSha: gitWorktree.headSha,
    primarySession: primarySessionItem,
    suggestedSessions: suggestedSessionItems,
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
    const providerSessionKey = toSessionKey(session.provider, session.providerSessionId);
    if (excludedSessionKeys.has(providerSessionKey)) {
      return [];
    }
    const activeTerminalRuntimeId = terminalRuntimeIdsBySessionKey?.get(providerSessionKey) ?? null;
    const item: SuggestedSessionListItem = {
      provider: session.provider,
      providerSessionKey,
      activeTerminalRuntimeId,
      state: activeTerminalRuntimeId ? "active" : "inactive",
      activityState: activeTerminalRuntimeId
        ? (agentActivityStatesByTerminalRuntimeId?.get(activeTerminalRuntimeId) ?? "waiting")
        : "waiting",
      preview: primarySessionPreviewsByKey?.get(providerSessionKey) ?? "",
      timestamp: session.timestamp ?? 0,
    };
    return [item];
  });
}
