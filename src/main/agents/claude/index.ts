import { setTimeout } from "node:timers/promises";
import fs from "fs";
import path from "path";
import { streamRipgrepLineMatches } from "../../ripgrep.js";
import type { PendingSession, SessionPreview, Agent, SessionSnapshot } from "../agent.js";
import { SessionLogWatcher, type ConversationMessage } from "../session-log-watcher.js";
import { parseJsonLinesAs, readTextFileIfExists } from "../store-utils.js";
import { type WorktreeSessionHint } from "../session-detection.js";
import { detectClaudeWorktreeSessionLines } from "./session-detection.js";
import {
  claudeHistoryPath,
  claudeProjectsPath,
  claudeSessionFilePath,
  pidFilePath,
} from "./paths.js";
import { loadWorktreeContextPrompt } from "../worktree-context-prompt.js";
import { isStoppedAtRateLimit } from "../rate-limit-stop.js";
import { classifyClaudeTranscriptLine } from "./rate-limit-stop.js";
import { getYuruClaudePluginDir } from "../../api/skill-materializer.js";
import { loadClaudePlanUsage } from "./plan-usage.js";

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
const CLAUDE_COMMAND_MESSAGE_PREFIXES = [
  "<bash-input>",
  "<bash-stdout>",
  "<command-message>",
  "<command-name>",
  "<local-command-stdout>",
] as const;

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

function parseClaudeConversationMessageEntry(entry: unknown): ConversationMessage | null {
  const message = entry as {
    type?: unknown;
    timestamp?: unknown;
    isMeta?: unknown;
    isSidechain?: unknown;
    promptSource?: unknown;
    message?: { role?: unknown; content?: unknown };
  } | null;
  const role = message?.message?.role;
  if (
    message?.isSidechain === true ||
    (message?.type !== "user" && message?.type !== "assistant") ||
    (role !== "user" && role !== "assistant") ||
    (role === "user" && (message.isMeta === true || message.promptSource === "system"))
  ) {
    return null;
  }
  const texts = extractClaudeMessageTexts(message.message?.content).filter(
    (text) =>
      role === "assistant" ||
      !CLAUDE_COMMAND_MESSAGE_PREFIXES.some((prefix) => text.trimStart().startsWith(prefix)),
  );
  return texts.length > 0
    ? { role, text: texts.join("\n"), timestamp: parseClaudeTimestamp(message.timestamp) }
    : null;
}

const sessionLogWatcher = new SessionLogWatcher(parseClaudeConversationMessageEntry);

function extractClaudeMessageTexts(content: unknown): string[] {
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

  return texts;
}

function parseClaudeTimestamp(timestamp: unknown): number {
  if (typeof timestamp !== "string") {
    return 0;
  }
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
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
        agentSessionId: entry.sessionId,
        project: entry.project,
        filePath,
        lastMessage: "",
        timestamp: entry.timestamp,
      });
    }
  }

  return Promise.all(
    Array.from(sessionMap.values()).map(async (session) => {
      sessionFilePathsById.set(session.agentSessionId, session.filePath);
      const preview = await sessionLogWatcher.read(session.filePath);
      return {
        provider: session.provider,
        agentSessionId: session.agentSessionId,
        project: session.project,
        lastMessage: preview?.lastMessage ?? "",
        timestamp: Math.max(session.timestamp, preview?.timestamp ?? 0),
      };
    }),
  );
}

async function loadStoredSessionPreview(agentSessionId: string): Promise<SessionPreview | null> {
  const sessionFilePath = await findClaudeSessionFile(agentSessionId);
  return sessionFilePath ? sessionLogWatcher.read(sessionFilePath) : null;
}

async function watchSessionMessages(
  agentSessionId: string,
  includeExistingMessages: boolean,
  listener: (messages: readonly string[]) => void,
): Promise<() => void> {
  const sessionFilePath = await findClaudeSessionFile(agentSessionId);
  if (!sessionFilePath) {
    return () => {};
  }
  return sessionLogWatcher.watch(sessionFilePath, includeExistingMessages, listener);
}

async function readClaudeHistoryEntries(): Promise<ClaudeHistoryEntry[]> {
  const content = await readTextFileIfExists(claudeHistoryPath());
  if (!content) {
    return [];
  }
  return parseJsonLinesAs(content, parseClaudeHistoryEntry);
}

async function findClaudeSessionFile(agentSessionId: string): Promise<string | null> {
  const cachedFilePath = sessionFilePathsById.get(agentSessionId);
  if (cachedFilePath && fs.existsSync(cachedFilePath)) {
    return cachedFilePath;
  }
  for (const entry of (await readClaudeHistoryEntries())
    .filter((historyEntry) => historyEntry.sessionId === agentSessionId)
    .sort((a, b) => b.timestamp - a.timestamp)) {
    const sessionFilePath = claudeSessionFilePath(entry.project, agentSessionId);
    if (fs.existsSync(sessionFilePath)) {
      sessionFilePathsById.set(agentSessionId, sessionFilePath);
      return sessionFilePath;
    }
  }

  return null;
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

async function isStoppedByRateLimit(agentSessionId: string): Promise<boolean> {
  const sessionFilePath = await findClaudeSessionFile(agentSessionId);
  return sessionFilePath === null
    ? false
    : isStoppedAtRateLimit(sessionFilePath, classifyClaudeTranscriptLine);
}

async function hasStoredSession(agentSessionId: string): Promise<boolean> {
  return (await findClaudeSessionFile(agentSessionId)) !== null;
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

export const agent: Agent = {
  definition: {
    id: "claude",
    label: "Claude",
  },
  command: "claude",
  resolvesSessionIdLazily: false,
  loadStoredSessions,
  loadStoredSessionPreview,
  watchSessionMessages,
  isStoppedByRateLimit,
  loadWorktreeSessionHints,
  hasStoredSession,
  loadPlanUsage: loadClaudePlanUsage,
  async createResumeLaunch(session) {
    return {
      cwd: session.cwd,
      args: ["--plugin-dir", getYuruClaudePluginDir(), "--resume", session.agentSessionId],
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
      // Claude still recognizes command names such as `doctor` after `--`.
      // A leading space keeps every value in the prompt operand while `--`
      // prevents option-like prompts from changing launch configuration.
      args.push("--", ` ${context.initialPrompt}`);
    }
    return {
      cwd: context.repoPath,
      args,
      worktreePath: context.worktreePath,
    };
  },
  waitForSessionId,
};
