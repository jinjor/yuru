import fs from "fs";
import path from "path";
import os from "os";
import { listWorktrees } from "./git.js";

export interface Session {
  id: string;
  project: string;
  projectName: string;
  lastMessage: string;
  timestamp: number;
  state: "active" | "inactive" | "archived";
  worktree?: {
    name: string;
    branch: string;
  };
}

const claudeDir = path.join(os.homedir(), ".claude");

function getActiveSessions(): Map<string, string> {
  const sessionsDir = path.join(claudeDir, "sessions");
  const active = new Map<string, string>();
  if (!fs.existsSync(sessionsDir)) {
    return active;
  }
  for (const file of fs.readdirSync(sessionsDir)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    try {
      const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), "utf-8"));
      if (data.sessionId) {
        active.set(data.sessionId, data.cwd);
      }
    } catch {
      // skip malformed files
    }
  }
  return active;
}

function decodeProjectPath(encoded: string): string {
  return encoded.replace(/^-/, "/").replace(/-/g, "/");
}

export async function loadSessions(): Promise<Session[]> {
  const historyPath = path.join(claudeDir, "history.jsonl");
  if (!fs.existsSync(historyPath)) {
    return [];
  }

  const activeSessions = getActiveSessions();

  // Build session info from history.jsonl (latest message per session)
  const sessionMap = new Map<string, { project: string; display: string; timestamp: number }>();
  const lines = fs.readFileSync(historyPath, "utf-8").trim().split("\n");
  for (const line of lines) {
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

  // Also scan projects/ for sessions not in history
  const projectsDir = path.join(claudeDir, "projects");
  if (fs.existsSync(projectsDir)) {
    for (const dir of fs.readdirSync(projectsDir)) {
      const dirPath = path.join(projectsDir, dir);
      if (!fs.statSync(dirPath).isDirectory()) {
        continue;
      }
      const projectPath = decodeProjectPath(dir);
      for (const file of fs.readdirSync(dirPath)) {
        if (!file.endsWith(".jsonl")) {
          continue;
        }
        const sid = file.replace(".jsonl", "");
        if (!sessionMap.has(sid)) {
          const stat = fs.statSync(path.join(dirPath, file));
          sessionMap.set(sid, {
            project: projectPath,
            display: "",
            timestamp: stat.mtimeMs,
          });
        }
      }
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
    if (activeSessions.has(id)) {
      state = "active";
    } else if (fs.existsSync(info.project)) {
      state = "inactive";
    } else {
      state = "archived";
    }

    const wt = worktreeMap.get(info.project);
    sessions.push({
      id,
      project: info.project,
      projectName: path.basename(info.project),
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
