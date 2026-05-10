import fs from "fs";
import path from "path";
import { getRepoRootForProject, listWorktrees } from "./git.js";
import { getGitHubPullRequestForBranch } from "./github.js";
import { sessionProviders } from "./agent-registry.js";
import type { RuntimeSessionInfo } from "./agent.js";
import type { WorktreeSessionHint } from "./worktree-session-detection.js";
import {
  toSessionKey,
  type Session,
  type SessionProvider,
  type SuggestedWorktreeSession,
} from "../shared/session.js";

interface WorktreeSessionScore {
  provider: SessionProvider;
  providerSessionId: string;
  worktreePath: string;
  worktreeRank: number;
  timestamp: number;
}

async function buildWorktreeMap(
  projectPaths: string[],
): Promise<Map<string, { name: string; branch: string | null }>> {
  const worktreeMap = new Map<string, { name: string; branch: string | null }>();
  for (const projectPath of projectPaths) {
    try {
      const worktrees = await listWorktrees(projectPath);
      for (const wt of worktrees) {
        worktreeMap.set(wt.path, {
          name: path.basename(wt.path),
          branch: wt.branch,
        });
      }
    } catch {
      // Skip paths that are not valid Git working trees.
    }
  }
  return worktreeMap;
}

async function buildRepoPathMap(projectPaths: string[]): Promise<Map<string, string>> {
  const repoPathMap = new Map<string, string>();
  await Promise.all(
    projectPaths.map(async (projectPath) => {
      const repoPath = await getRepoRootForProject(projectPath);
      if (repoPath) {
        repoPathMap.set(projectPath, repoPath);
      }
    }),
  );
  return repoPathMap;
}

async function loadStoredSessionSnapshots() {
  return (
    await Promise.all(Object.values(sessionProviders).map((provider) => provider.loadStoredSessions()))
  ).flat();
}

export async function loadStoredSessionPreviews(): Promise<Map<string, string>> {
  const previews = new Map<string, string>();
  for (const snapshot of await loadStoredSessionSnapshots()) {
    previews.set(toSessionKey(snapshot.provider, snapshot.providerSessionId), snapshot.lastMessage);
  }
  return previews;
}

export async function loadSuggestedWorktreeSessions(
  worktreePaths: readonly string[],
): Promise<Map<string, SuggestedWorktreeSession[]>> {
  const worktreePathByKey = new Map(
    worktreePaths.map((worktreePath) => [path.resolve(worktreePath), worktreePath]),
  );
  const suggestionsByWorktreePath = new Map<string, SuggestedWorktreeSession[]>();
  const timestampsBySessionKey = new Map(
    (await loadStoredSessionSnapshots()).map((snapshot) => [
      toSessionKey(snapshot.provider, snapshot.providerSessionId),
      snapshot.timestamp,
    ]),
  );
  const hints = (
    await Promise.all(
      Object.values(sessionProviders).map((provider) => provider.loadWorktreeSessionHints(worktreePaths)),
    )
  )
    .flat()
    .flatMap((hint) => {
      const worktreePath = worktreePathByKey.get(path.resolve(hint.worktreePath));
      return worktreePath ? [{ ...hint, worktreePath }] : [];
    });

  for (const score of rankWorktreeSessionScores(hints, timestampsBySessionKey)) {
    const suggestions = suggestionsByWorktreePath.get(score.worktreePath) ?? [];
    suggestions.push({
      provider: score.provider,
      providerSessionId: score.providerSessionId,
      timestamp: score.timestamp,
    });
    suggestionsByWorktreePath.set(score.worktreePath, suggestions);
  }

  return suggestionsByWorktreePath;
}

function rankWorktreeSessionScores(
  hints: readonly WorktreeSessionHint[],
  timestampsBySessionKey: ReadonlyMap<string, number>,
): WorktreeSessionScore[] {
  const scoresByKey = new Map<string, WorktreeSessionScore>();

  for (const hint of hints) {
    const sessionKey = toSessionKey(hint.provider, hint.providerSessionId);
    const scoreKey = `${sessionKey}:${hint.worktreePath}`;
    const nextScore: WorktreeSessionScore = {
      provider: hint.provider,
      providerSessionId: hint.providerSessionId,
      worktreePath: hint.worktreePath,
      worktreeRank: hint.worktreeRank,
      timestamp: timestampsBySessionKey.get(sessionKey) ?? 0,
    };
    const existingScore = scoresByKey.get(scoreKey);
    if (!existingScore || compareWorktreeSessionScores(nextScore, existingScore) < 0) {
      scoresByKey.set(scoreKey, nextScore);
    }
  }

  return Array.from(scoresByKey.values()).sort(compareWorktreeSessionScores);
}

function compareWorktreeSessionScores(a: WorktreeSessionScore, b: WorktreeSessionScore): number {
  const worktreePathOrder = a.worktreePath.localeCompare(b.worktreePath);
  if (worktreePathOrder !== 0) {
    return worktreePathOrder;
  }
  const worktreeRankOrder = a.worktreeRank - b.worktreeRank;
  if (worktreeRankOrder !== 0) {
    return worktreeRankOrder;
  }
  const providerOrder = a.provider.localeCompare(b.provider);
  if (providerOrder !== 0) {
    return providerOrder;
  }
  return a.providerSessionId.localeCompare(b.providerSessionId);
}

export async function loadSessions(
  runtimeActiveSessions?: ReadonlyMap<string, RuntimeSessionInfo>,
): Promise<Session[]> {
  const activeSessions = runtimeActiveSessions ?? new Map<string, RuntimeSessionInfo>();
  const snapshots = await loadStoredSessionSnapshots();
  const projectPaths = Array.from(
    new Set(snapshots.map((snapshot) => snapshot.project)),
  );
  const worktreeMap = await buildWorktreeMap(projectPaths);
  const repoPathMap = await buildRepoPathMap(projectPaths);
  const runtimeIdByProviderSessionKey = new Map<string, string>();
  for (const [id, info] of activeSessions) {
    if (!info.providerSessionId) {
      continue;
    }
    runtimeIdByProviderSessionKey.set(toSessionKey(info.provider, info.providerSessionId), id);
  }

  const sessions: Session[] = snapshots.map((snapshot) => {
    const providerSessionKey = toSessionKey(snapshot.provider, snapshot.providerSessionId);
    const runtimeSessionId = runtimeIdByProviderSessionKey.get(providerSessionKey);
    const id = runtimeSessionId ?? providerSessionKey;
    const project = snapshot.project;
    const state: Session["state"] = runtimeSessionId
      ? "active"
      : fs.existsSync(snapshot.project)
        ? "inactive"
        : "archived";

    return {
      id,
      provider: snapshot.provider,
      providerSessionId: snapshot.providerSessionId,
      project,
      projectName: path.basename(project),
      repoPath: repoPathMap.get(project) ?? project,
      lastMessage: snapshot.lastMessage,
      timestamp: snapshot.timestamp,
      state,
      worktree: worktreeMap.get(project),
    } satisfies Session;
  });

  const worktreeQueries = new Map<string, Promise<Session["github"]>>();
  for (const session of sessions) {
    if (!session.worktree?.branch || session.state === "archived") {
      continue;
    }
    const cacheKey = `${session.repoPath}:${session.worktree.branch}`;
    if (!worktreeQueries.has(cacheKey)) {
      worktreeQueries.set(
        cacheKey,
        getGitHubPullRequestForBranch(session.repoPath, session.worktree.branch),
      );
    }
  }

  await Promise.all(
    sessions.map(async (session) => {
      if (!session.worktree?.branch || session.state === "archived") {
        session.github = null;
        return;
      }

      const cacheKey = `${session.repoPath}:${session.worktree.branch}`;
      session.github = (await worktreeQueries.get(cacheKey)) ?? null;
    }),
  );

  sessions.sort((a, b) => b.timestamp - a.timestamp);
  return sessions;
}
