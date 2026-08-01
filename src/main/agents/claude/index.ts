import { setTimeout } from "node:timers/promises";
import fs from "fs";
import path from "path";
import { streamRipgrepLineMatches } from "../../ripgrep.js";
import type {
  PendingSession,
  SessionPreview,
  SessionProviderAdapter,
  SessionSnapshot,
} from "../../agent.js";
import { parseJsonLinesAs, readTextFileIfExists } from "../../agent-store-utils.js";
import { type WorktreeSessionHint } from "../../worktree-session-detection.js";
import { detectClaudeWorktreeSessionLines } from "./worktree-session-detection.js";
import {
  claudeHistoryPath,
  claudeProjectsPath,
  claudeSessionFilePath,
  pidFilePath,
} from "./paths.js";
import { loadWorktreeContextPrompt } from "../../worktree-context-prompt.js";
import { IncrementalSessionPreviewReader } from "../../session-preview-reader.js";
import { getYuruClaudePluginDir } from "../../skill-materializer.js";

interface ClaudeHistoryEntry {
  sessionId: string;
  project: string;
  display: string;
  timestamp: number;
}

interface ClaudeStoredSession extends SessionSnapshot {
  filePath: string;
}

const sessionFilePathsById = new Map<string, string>();

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

function parseClaudeAssistantPreviewEntry(entry: unknown): SessionPreview | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const maybeEntry = entry as {
    type?: unknown;
    timestamp?: unknown;
    message?: {
      role?: unknown;
      content?: unknown;
    };
  };
  if (maybeEntry.type !== "assistant" || maybeEntry.message?.role !== "assistant") {
    return null;
  }

  const lastMessage = extractClaudeMessageText(maybeEntry.message.content);
  if (!lastMessage) {
    return null;
  }
  return {
    lastMessage,
    timestamp: parseClaudeTimestamp(maybeEntry.timestamp),
  };
}

const sessionPreviewReader = new IncrementalSessionPreviewReader(parseClaudeAssistantPreviewEntry);

function extractClaudeMessageText(content: unknown): string {
  const texts: string[] = [];
  if (typeof content === "string") {
    texts.push(content);
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const maybeItem = item as { type?: unknown; text?: unknown };
      if (maybeItem.type === "text" && typeof maybeItem.text === "string") {
        texts.push(maybeItem.text);
      }
    }
  }

  return normalizePreviewText(texts.join("\n"));
}

function parseClaudeTimestamp(timestamp: unknown): number {
  if (typeof timestamp !== "string") {
    return 0;
  }
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizePreviewText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function loadStoredSessions(): Promise<SessionSnapshot[]> {
  const sessionMap = new Map<string, ClaudeStoredSession>();
  for (const entry of await readClaudeHistoryEntries()) {
    const filePath = claudeSessionFilePath(entry.project, entry.sessionId);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const existing = sessionMap.get(entry.sessionId);
    if (!existing || entry.timestamp > existing.timestamp) {
      sessionMap.set(entry.sessionId, {
        provider: "claude",
        providerSessionId: entry.sessionId,
        project: entry.project,
        filePath,
        lastMessage: "",
        timestamp: entry.timestamp,
      });
    }
  }

  return Promise.all(
    Array.from(sessionMap.values()).map(async (session) => {
      sessionFilePathsById.set(session.providerSessionId, session.filePath);
      const preview = await readClaudeSessionPreview(session.filePath);
      return {
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        project: session.project,
        lastMessage: preview?.lastMessage ?? "",
        timestamp: Math.max(session.timestamp, preview?.timestamp ?? 0),
      };
    }),
  );
}

async function loadStoredSessionPreview(providerSessionId: string): Promise<SessionPreview | null> {
  const sessionFilePath = await findClaudeSessionFile(providerSessionId);
  return sessionFilePath ? readClaudeSessionPreview(sessionFilePath) : null;
}

async function readClaudeHistoryEntries(): Promise<ClaudeHistoryEntry[]> {
  const content = await readTextFileIfExists(claudeHistoryPath());
  if (!content) {
    return [];
  }
  return parseJsonLinesAs(content, parseClaudeHistoryEntry);
}

async function findClaudeSessionFile(providerSessionId: string): Promise<string | null> {
  const cachedFilePath = sessionFilePathsById.get(providerSessionId);
  if (cachedFilePath && fs.existsSync(cachedFilePath)) {
    return cachedFilePath;
  }
  for (const entry of (await readClaudeHistoryEntries())
    .filter((historyEntry) => historyEntry.sessionId === providerSessionId)
    .sort((a, b) => b.timestamp - a.timestamp)) {
    const sessionFilePath = claudeSessionFilePath(entry.project, providerSessionId);
    if (fs.existsSync(sessionFilePath)) {
      sessionFilePathsById.set(providerSessionId, sessionFilePath);
      return sessionFilePath;
    }
  }

  return null;
}

async function readClaudeSessionPreview(filePath: string): Promise<SessionPreview | null> {
  return sessionPreviewReader.read(filePath);
}

async function loadWorktreeSessionHints(
  worktreePaths: readonly string[],
): Promise<WorktreeSessionHint[]> {
  if (worktreePaths.length === 0) {
    return [];
  }

  const projectsDir = claudeProjectsPath();
  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  const worktreePathKeys = new Set(worktreePaths.map((worktreePath) => path.resolve(worktreePath)));
  const hints: WorktreeSessionHint[] = [];
  await streamRipgrepLineMatches(
    [
      "--hidden",
      ...buildClaudeEvidencePatterns(worktreePaths).flatMap((pattern) => ["--regexp", pattern]),
      "--",
      projectsDir,
    ],
    projectsDir,
    (_filePath, lines) => {
      hints.push(
        ...detectClaudeWorktreeSessionLines(lines, worktreePaths).filter((hint) =>
          worktreePathKeys.has(path.resolve(hint.worktreePath)),
        ),
      );
    },
  );

  return hints;
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

async function hasStoredSession(providerSessionId: string): Promise<boolean> {
  return (await findClaudeSessionFile(providerSessionId)) !== null;
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
  loadStoredSessionPreview,
  loadWorktreeSessionHints,
  hasStoredSession,
  findSessionTranscriptPath: findClaudeSessionFile,
  async createResumeLaunch(session) {
    return {
      cwd: session.cwd,
      args: ["--plugin-dir", getYuruClaudePluginDir(), "--resume", session.providerSessionId],
      worktreePath: session.project,
    };
  },
  async createWorktreeLaunch(context) {
    const args = ["--plugin-dir", getYuruClaudePluginDir()];
    if (context.model !== undefined) {
      args.push("--model", context.model);
    }
    args.push("--append-system-prompt", await loadWorktreeContextPrompt(context));
    if (context.initialPrompt !== undefined) {
      args.push(context.initialPrompt);
    }
    return {
      cwd: context.repoPath,
      args,
      worktreePath: context.worktreePath,
    };
  },
  waitForSessionId,
};
