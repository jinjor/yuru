import fs from "fs";
import path from "path";
import { getRepoRootForProject, listWorktrees } from "./git.js";
import { getGitHubPullRequestForBranch } from "./github.js";
import { sessionProviders } from "./agent-registry.js";
import type { RuntimeSessionInfo } from "./agent.js";
import { toSessionKey, type Session } from "../shared/session.js";

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

export async function loadSessions(
  runtimeActiveSessions?: ReadonlyMap<string, RuntimeSessionInfo>,
): Promise<Session[]> {
  const activeSessions = runtimeActiveSessions ?? new Map<string, RuntimeSessionInfo>();
  const snapshots = await loadStoredSessionSnapshots();
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
    const project = runtime?.info.cwd ?? snapshot.project;
    const state: Session["state"] = runtime
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
