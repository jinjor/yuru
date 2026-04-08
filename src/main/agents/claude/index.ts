import { setTimeout } from "node:timers/promises";
import fs from "fs";
import { branchExists, renameBranch } from "../../git.js";
import { SessionProviderAdapter, SessionSnapshot, PendingSession, WorktreeContext } from "../../agent.js";
import { parseJsonLinesAs, readTextFileIfExists } from "../../agent-store-utils.js";
import {
  claudeBranchName,
  claudeHistoryPath,
  claudeRepoPathFromProject,
  claudeWorktreeCwd,
  pidFilePath,
} from "./paths.js";

interface ClaudeHistoryEntry {
  sessionId: string;
  project: string;
  display: string;
  timestamp: number;
}

function parseClaudeHistoryEntry(entry: unknown): ClaudeHistoryEntry | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const maybeEntry = entry as {
    sessionId?: unknown;
    project?: unknown;
    display?: unknown;
    timestamp?: unknown;
  };

  if (typeof maybeEntry.sessionId !== "string" || typeof maybeEntry.project !== "string") {
    return null;
  }
  if (typeof maybeEntry.timestamp !== "number") {
    return null;
  }

  return {
    sessionId: maybeEntry.sessionId,
    project: maybeEntry.project,
    display: typeof maybeEntry.display === "string" ? maybeEntry.display : "",
    timestamp: maybeEntry.timestamp,
  };
}

async function loadStoredSessions(): Promise<SessionSnapshot[]> {
  const content = await readTextFileIfExists(claudeHistoryPath());
  if (!content) {
    return [];
  }

  const sessionMap = new Map<string, SessionSnapshot>();
  for (const entry of parseJsonLinesAs(content, parseClaudeHistoryEntry)) {
    const existing = sessionMap.get(entry.sessionId);
    if (!existing || entry.timestamp > existing.timestamp) {
      sessionMap.set(entry.sessionId, {
        provider: "claude",
        providerSessionId: entry.sessionId,
        project: entry.project,
        lastMessage: entry.display,
        timestamp: entry.timestamp,
      });
    }
  }

  return Array.from(sessionMap.values());
}

async function waitForSessionId(pending: PendingSession): Promise<string> {
  const sessionFile = pidFilePath(pending.proc.pid);
  for (let attempt = 0; attempt < 150; attempt++) {
    if (fs.existsSync(sessionFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
        if (typeof data.sessionId === "string" && data.sessionId) {
          return data.sessionId;
        }
      } catch {
        // Ignore partial writes while Claude is still initializing the session file.
      }
    }
    if (pending.exited) {
      throw new Error("Claude exited before creating a session");
    }
    await setTimeout(200);
  }
  throw new Error("Timeout waiting for Claude session initialization");
}

export const sessionProvider: SessionProviderAdapter = {
  definition: {
    id: "claude",
    label: "Claude",
  },
  command: "claude",
  resolvesSessionIdLazily: false,
  loadStoredSessions,
  async createNewLaunch(repoPath) {
    return {
      cwd: repoPath,
      args: [],
      sessionCwd: repoPath,
    };
  },
  async createResumeLaunch(session) {
    return {
      cwd: session.project,
      args: ["--resume", session.providerSessionId],
      sessionCwd: session.project,
    };
  },
  async createWorktreeLaunch(context) {
    return {
      cwd: context.repoPath,
      args: ["--worktree", context.worktreeName],
      sessionCwd: context.worktreePath,
    };
  },
  async prepareWorktree() {
    return;
  },
  async finalizeWorktree(context: WorktreeContext) {
    const branchName = claudeBranchName(context.worktreeName);
    if (context.branchName === branchName) {
      return;
    }

    for (let attempt = 0; attempt < 150; attempt++) {
      if (await branchExists(context.repoPath, branchName)) {
        await renameBranch(context.worktreePath, branchName, context.branchName);
        return;
      }
      await setTimeout(200);
    }

    throw new Error("Timeout waiting for branch creation");
  },
  resolveWorktreePath(repoPath, worktreeName) {
    return claudeWorktreeCwd(repoPath, worktreeName);
  },
  repoPathFromProject(projectPath) {
    return claudeRepoPathFromProject(projectPath);
  },
  waitForSessionId,
};
