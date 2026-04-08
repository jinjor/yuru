import fs from "fs";
import path from "path";
import { listWorktrees } from "./git.js";
import { getSessionProvider, sessionProviders } from "./agent-registry.js";
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
  const worktreeMap = await buildWorktreeMap(
    Array.from(
      new Set([
        ...snapshots.map((snapshot) => snapshot.project),
        ...runtimeSessions.map((runtime) => runtime.cwd),
      ]),
    ),
  );
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
      repoPath: getSessionProvider(snapshot.provider).repoPathFromProject(snapshot.project),
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
      repoPath: getSessionProvider(info.provider).repoPathFromProject(info.cwd),
      lastMessage: "",
      timestamp: info.startedAt,
      state: "active",
      worktree: worktreeMap.get(info.cwd),
    } satisfies Session);
  }

  sessions.sort((a, b) => b.timestamp - a.timestamp);
  return sessions;
}
