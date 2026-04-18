import fs from "fs";
import path from "path";
import { getRepoRootForProject, listWorktrees } from "./git.js";
import { getGitHubPullRequestForBranch } from "./github.js";
import { sessionProviders } from "./agent-registry.js";
import { RuntimeSessionInfo } from "./agent.js";
import { Session, toSessionKey } from "../shared/session.js";

async function buildWorktreeMap(projectPaths: string[]): Promise<Map<string, { name: string; branch: string }>> {
  const worktreeMap = new Map<string, { name: string; branch: string }>();
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

export async function loadSessions(
  runtimeActiveSessions?: ReadonlyMap<string, RuntimeSessionInfo>,
): Promise<Session[]> {
  const activeSessions = runtimeActiveSessions ?? new Map<string, RuntimeSessionInfo>();
  const snapshots = (
    await Promise.all(Object.values(sessionProviders).map((provider) => provider.loadStoredSessions()))
  ).flat();
  const runtimeSessions = Array.from(activeSessions, ([id, info]) => ({
    id,
    ...info,
  }));
  const projectPaths = Array.from(
    new Set([
      ...snapshots.map((snapshot) => snapshot.project),
      ...runtimeSessions.map((runtime) => runtime.cwd),
    ]),
  );
  const worktreeMap = await buildWorktreeMap(projectPaths);
  const repoPathMap = await buildRepoPathMap(projectPaths);
  const runtimeByProviderSessionKey = new Map<string, { id: string; info: RuntimeSessionInfo }>();
  for (const [id, info] of activeSessions) {
    if (!info.providerSessionId) {
      continue;
    }
    runtimeByProviderSessionKey.set(toSessionKey(info.provider, info.providerSessionId), { id, info });
  }

  const sessions: Session[] = snapshots.map((snapshot) => {
    const providerSessionKey = toSessionKey(snapshot.provider, snapshot.providerSessionId);
    const runtime = runtimeByProviderSessionKey.get(providerSessionKey);
    const id = runtime?.id ?? providerSessionKey;
    let state: Session["state"];
    if (!fs.existsSync(snapshot.project)) {
      state = "archived";
    } else if (runtime) {
      state = "active";
    } else {
      state = "inactive";
    }

    return {
      id,
      provider: snapshot.provider,
      providerSessionId: snapshot.providerSessionId,
      project: snapshot.project,
      projectName: path.basename(snapshot.project),
      repoPath: repoPathMap.get(snapshot.project) ?? snapshot.project,
      lastMessage: snapshot.lastMessage,
      timestamp: snapshot.timestamp,
      state,
      worktree: worktreeMap.get(snapshot.project),
    } satisfies Session;
  });

  for (const [id, info] of activeSessions) {
    if (info.providerSessionId) {
      const providerSessionKey = toSessionKey(info.provider, info.providerSessionId);
      if (snapshots.some((snapshot) => toSessionKey(snapshot.provider, snapshot.providerSessionId) === providerSessionKey)) {
        continue;
      }
    }

    sessions.push({
      id,
      provider: info.provider,
      providerSessionId: info.providerSessionId,
      project: info.cwd,
      projectName: path.basename(info.cwd),
      repoPath: repoPathMap.get(info.cwd) ?? info.cwd,
      lastMessage: "",
      timestamp: info.startedAt,
      state: "active",
      worktree: worktreeMap.get(info.cwd),
    } satisfies Session);
  }

  const worktreeQueries = new Map<string, Promise<Session["github"]>>();
  for (const session of sessions) {
    if (!session.worktree || session.state === "archived") {
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
      if (!session.worktree || session.state === "archived") {
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
