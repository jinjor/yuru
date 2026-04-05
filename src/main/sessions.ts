import fs from "fs";
import path from "path";
import { listWorktrees } from "./git.js";
import { claudeDir, historyPath, repoPathFromCwd } from "./claude-paths.js";

export { claudeDir };

export interface Session {
  id: string;
  project: string;
  projectName: string;
  repoPath: string;
  lastMessage: string;
  timestamp: number;
  state: "active" | "inactive" | "archived";
  worktree?: {
    name: string;
    branch: string;
  };
}

export async function loadSessions(runtimeActiveSessions?: ReadonlyMap<string, string>): Promise<Session[]> {
  if (!fs.existsSync(historyPath)) {
    return [];
  }

  const activeSessions = runtimeActiveSessions ?? new Map<string, string>();

  // Build session info from history.jsonl (latest message per session)
  const sessionMap = new Map<string, { project: string; display: string; timestamp: number }>();
  const content = fs.readFileSync(historyPath, "utf-8");
  const lines = content.split("\n");
  for (const line of lines) {
    if (!line) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      const sid = entry.sessionId as string;
      const ts = entry.timestamp as number;
      if (!sessionMap.has(sid) || ts > (sessionMap.get(sid) as { timestamp: number }).timestamp) {
        sessionMap.set(sid, {
          project: entry.project,
          display: entry.display,
          timestamp: ts,
        });
      }
    } catch {
      // skip malformed lines
    }
  }

  // Collect unique repo paths and fetch worktree info
  const repoPaths = new Set<string>();
  for (const info of sessionMap.values()) {
    repoPaths.add(info.project);
  }
  // Map from worktree path to worktree info
  const worktreeMap = new Map<string, { name: string; branch: string }>();
  for (const repoPath of repoPaths) {
    try {
      const worktrees = await listWorktrees(repoPath);
      for (const wt of worktrees) {
        worktreeMap.set(wt.path, {
          name: path.basename(wt.path),
          branch: wt.branch,
        });
      }
    } catch {
      // Not a git repo or git not available — skip
    }
  }

  // Build session list
  const sessions: Session[] = [];
  for (const [id, info] of sessionMap) {
    let state: Session["state"];
    if (!fs.existsSync(info.project)) {
      state = "archived";
    } else if (activeSessions.has(id)) {
      state = "active";
    } else {
      state = "inactive";
    }

    const wt = worktreeMap.get(info.project);
    const repoPath = repoPathFromCwd(info.project);
    sessions.push({
      id,
      project: info.project,
      projectName: path.basename(info.project),
      repoPath,
      lastMessage: info.display,
      timestamp: info.timestamp,
      state,
      worktree: wt,
    });
  }

  // Sort by timestamp descending
  sessions.sort((a, b) => b.timestamp - a.timestamp);
  return sessions;
}
