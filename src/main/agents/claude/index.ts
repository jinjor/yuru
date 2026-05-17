import { setTimeout } from "node:timers/promises";
import fs from "fs";
import path from "path";
import { exec } from "../../exec.js";
import { createWorktree } from "../../git.js";
import type {
  PendingSession,
  SessionProviderAdapter,
  SessionSnapshot,
  WorktreeContext,
} from "../../agent.js";
import {
  listFilesRecursive,
  parseJsonLinesAs,
  readTextFileIfExists,
} from "../../agent-store-utils.js";
import { type WorktreeSessionHint } from "../../worktree-session-detection.js";
import {
  detectClaudeWorktreeSessionLines,
  type ClaudeSessionLine,
} from "./worktree-session-detection.js";
import { claudeHistoryPath, claudeProjectsPath, claudeWorktreeCwd, pidFilePath } from "./paths.js";
import { loadWorktreeContextPrompt } from "../../worktree-context-prompt.js";

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

async function loadWorktreeSessionHints(
  worktreePaths: readonly string[],
): Promise<WorktreeSessionHint[]> {
  if (worktreePaths.length === 0) {
    return [];
  }

  const worktreePathKeys = new Set(worktreePaths.map((worktreePath) => path.resolve(worktreePath)));
  const hints: WorktreeSessionHint[] = [];
  await Promise.all(
    Array.from(await listClaudeSessionLineMatches(worktreePaths)).map(
      async ([_filePath, lines]) => {
        hints.push(
          ...detectClaudeWorktreeSessionLines(lines, worktreePaths).filter((hint) =>
            worktreePathKeys.has(path.resolve(hint.worktreePath)),
          ),
        );
      },
    ),
  );

  return hints;
}

async function listClaudeSessionLineMatches(
  worktreePaths: readonly string[],
): Promise<Map<string, ClaudeSessionLine[]>> {
  const projectsDir = claudeProjectsPath();
  if (!fs.existsSync(projectsDir)) {
    return new Map();
  }

  const patterns = buildClaudeEvidencePatterns(worktreePaths);
  if (patterns.length === 0) {
    return new Map();
  }

  try {
    const output = await exec(
      "rg",
      [
        "--json",
        "--hidden",
        ...patterns.flatMap((pattern) => ["--regexp", pattern]),
        "--",
        projectsDir,
      ],
      projectsDir,
    );
    return parseRipgrepJsonLineMatches(output);
  } catch (error) {
    if ((error as { code?: string | number }).code === 1) {
      return new Map();
    }
    throw error;
  }
}

function buildClaudeEvidencePatterns(worktreePaths: readonly string[]): string[] {
  return worktreePaths.flatMap((worktreePath) => {
    const escapedPath = escapeRegex(path.resolve(worktreePath));
    return [`"cwd".*${escapedPath}`, `"file_path".*${escapedPath}`];
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function parseRipgrepJsonLineMatches(output: string): Map<string, ClaudeSessionLine[]> {
  const matchesByFilePath = new Map<string, ClaudeSessionLine[]>();

  for (const line of output.split("\n")) {
    if (!line) {
      continue;
    }

    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      continue;
    }

    if (typeof message !== "object" || message === null) {
      continue;
    }

    const match = message as {
      type?: unknown;
      data?: {
        path?: { text?: unknown };
        lines?: { text?: unknown };
        line_number?: unknown;
      };
    };
    if (match.type !== "match") {
      continue;
    }
    if (
      typeof match.data?.path?.text !== "string" ||
      typeof match.data?.lines?.text !== "string" ||
      typeof match.data?.line_number !== "number"
    ) {
      continue;
    }

    const filePath = match.data.path.text;
    const lines = matchesByFilePath.get(filePath) ?? [];
    lines.push({
      text: stripTrailingLineBreak(match.data.lines.text),
      lineIndex: match.data.line_number - 1,
    });
    matchesByFilePath.set(filePath, lines);
  }

  for (const lines of matchesByFilePath.values()) {
    lines.sort((a, b) => a.lineIndex - b.lineIndex);
  }

  return matchesByFilePath;
}

function stripTrailingLineBreak(line: string): string {
  return line.replace(/\r?\n$/, "");
}

async function hasStoredSession(providerSessionId: string): Promise<boolean> {
  if (
    (await loadStoredSessions()).some((session) => session.providerSessionId === providerSessionId)
  ) {
    return true;
  }

  const sessionFileName = `${providerSessionId}.jsonl`;
  return (await listFilesRecursive(claudeProjectsPath())).some((filePath) =>
    filePath.endsWith(`/${sessionFileName}`),
  );
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
  loadWorktreeSessionHints,
  hasStoredSession,
  async createResumeLaunch(session) {
    return {
      cwd: session.repoPath,
      args: ["--resume", session.providerSessionId],
      worktreePath: session.project,
    };
  },
  async createWorktreeLaunch(context) {
    return {
      cwd: context.repoPath,
      args: ["--append-system-prompt", await loadWorktreeContextPrompt(context)],
      worktreePath: context.worktreePath,
    };
  },
  async prepareWorktree(context: WorktreeContext) {
    await createWorktree(context.repoPath, context.worktreePath, context.branchName);
  },
  async finalizeWorktree() {
    return;
  },
  resolveWorktreePath(repoPath, worktreeName) {
    return claudeWorktreeCwd(repoPath, worktreeName);
  },
  waitForSessionId,
};
