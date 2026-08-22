import { setTimeout } from "node:timers/promises";
import fs from "fs";
import path from "path";
import { streamRipgrepLineMatches } from "../../ripgrep.js";
import type { PendingSession, SessionPreview, Agent, SessionSnapshot } from "../agent.js";
import { IncrementalJsonlReader } from "../incremental-jsonl-reader.js";
import { isStoppedAtRateLimit } from "../rate-limit-stop.js";
import { classifyKimiSessionLogLine } from "./rate-limit-stop.js";
import { parseJsonLinesAs, readTextFileIfExists } from "../store-utils.js";
import type { WorktreeSessionHint } from "../session-detection.js";
import {
  loadWorktreeContextPrompt,
  WORKTREE_CONTEXT_PROMPT_MARKER,
} from "../worktree-context-prompt.js";
import { assertValidTerminalInput } from "../../terminal/initial-input.js";
import {
  kimiSessionIndexPath,
  kimiSessionStatePath,
  kimiSessionLogPath,
  kimiSessionsDir,
  kimiWireLogPath,
} from "./paths.js";
import { loadKimiPlanUsage } from "./plan-usage.js";
import {
  detectKimiMentionHints,
  detectKimiWorkDirHint,
  normalizeRealPath,
  type KimiStoredSessionRef,
} from "./session-detection.js";

interface KimiSessionState {
  createdAt: string;
  updatedAt: string;
}

interface KimiConversationMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

interface KimiSessionLog {
  reader: IncrementalJsonlReader;
  preview: SessionPreview | null;
  messageListener: ((messages: readonly string[]) => void) | null;
}

// Kimi has no model-facing initial-message input for its interactive TUI yet:
// https://github.com/MoonshotAI/kimi-code/issues/2507
const KIMI_USER_MESSAGE_PREFIX = "User request:\n\n";

function toKimiUserMessage(initialPrompt: string): string {
  assertValidTerminalInput(initialPrompt);
  return `${KIMI_USER_MESSAGE_PREFIX}${initialPrompt}`;
}

const sessionRefsById = new Map<string, KimiStoredSessionRef>();

function parseKimiSessionIndexEntry(entry: unknown): KimiStoredSessionRef | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const maybeEntry = entry as {
    sessionId?: unknown;
    sessionDir?: unknown;
    workDir?: unknown;
  };
  if (
    typeof maybeEntry.sessionId !== "string" ||
    typeof maybeEntry.sessionDir !== "string" ||
    typeof maybeEntry.workDir !== "string"
  ) {
    return null;
  }
  return {
    agentSessionId: maybeEntry.sessionId,
    sessionDir: maybeEntry.sessionDir,
    workDir: maybeEntry.workDir,
  };
}

function parseKimiSessionState(value: unknown): KimiSessionState | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const maybeState = value as {
    createdAt?: unknown;
    updatedAt?: unknown;
  };
  return {
    createdAt: typeof maybeState.createdAt === "string" ? maybeState.createdAt : "",
    updatedAt: typeof maybeState.updatedAt === "string" ? maybeState.updatedAt : "",
  };
}

function parseKimiTimestamp(raw: string): number {
  if (!raw) {
    return 0;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function readKimiSessionIndex(): Promise<KimiStoredSessionRef[]> {
  const content = await readTextFileIfExists(kimiSessionIndexPath());
  if (!content) {
    return [];
  }
  const entries = parseJsonLinesAs(content, parseKimiSessionIndexEntry);
  for (const entry of entries) {
    sessionRefsById.set(entry.agentSessionId, entry);
  }
  return entries;
}

async function findKimiSessionRef(agentSessionId: string): Promise<KimiStoredSessionRef | null> {
  const cached = sessionRefsById.get(agentSessionId);
  if (cached && fs.existsSync(cached.sessionDir)) {
    return cached;
  }
  const entry = (await readKimiSessionIndex()).find(
    (candidate) => candidate.agentSessionId === agentSessionId,
  );
  return entry && fs.existsSync(entry.sessionDir) ? entry : null;
}

async function readKimiSessionState(sessionDir: string): Promise<KimiSessionState | null> {
  const content = await readTextFileIfExists(kimiSessionStatePath(sessionDir));
  if (!content) {
    return null;
  }
  try {
    return parseKimiSessionState(JSON.parse(content));
  } catch {
    return null;
  }
}

function parseKimiConversationMessageEntry(entry: unknown): KimiConversationMessage | null {
  const maybeEntry = entry as {
    type?: unknown;
    timestamp?: unknown;
    message?: { role?: unknown; content?: unknown; origin?: { kind?: unknown } };
    event?: {
      type?: unknown;
      part?: { type?: unknown; text?: unknown };
    };
  } | null;

  if (
    maybeEntry?.type === "context.append_message" &&
    maybeEntry.message?.role === "user" &&
    maybeEntry.message.origin?.kind === "user"
  ) {
    const text = extractKimiTextContent(maybeEntry.message.content)
      .filter((text) => !text.includes(WORKTREE_CONTEXT_PROMPT_MARKER))
      .join("\n");
    return text
      ? { role: "user", text, timestamp: parseKimiEntryTimestamp(maybeEntry.timestamp) }
      : null;
  }
  if (
    maybeEntry?.type === "context.append_loop_event" &&
    maybeEntry.event?.type === "content.part" &&
    maybeEntry.event.part?.type === "text" &&
    typeof maybeEntry.event.part.text === "string"
  ) {
    return {
      role: "assistant",
      text: maybeEntry.event.part.text,
      timestamp: parseKimiEntryTimestamp(maybeEntry.timestamp),
    };
  }
  return null;
}

function extractKimiTextContent(content: unknown): string[] {
  return typeof content === "string"
    ? [content]
    : Array.isArray(content)
      ? content.flatMap((part) => {
          const item = part as { type?: unknown; text?: unknown } | null;
          return item?.type === "text" && typeof item.text === "string" ? [item.text] : [];
        })
      : [];
}

function parseKimiEntryTimestamp(timestamp: unknown): number {
  return typeof timestamp === "string" ? parseKimiTimestamp(timestamp) : 0;
}

function normalizePreviewText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const sessionLogs = new Map<string, KimiSessionLog>();

function getSessionLog(filePath: string): KimiSessionLog {
  let log = sessionLogs.get(filePath);
  if (!log) {
    log = {
      reader: new IncrementalJsonlReader(filePath),
      preview: null,
      messageListener: null,
    };
    sessionLogs.set(filePath, log);
  }
  return log;
}

async function listExistingSessionIds(): Promise<Set<string>> {
  return new Set((await readKimiSessionIndex()).map((entry) => entry.agentSessionId));
}

async function loadStoredSessions(): Promise<SessionSnapshot[]> {
  const entries = await readKimiSessionIndex();
  return Promise.all(
    entries.map(async (entry) => {
      const [state, preview] = await Promise.all([
        readKimiSessionState(entry.sessionDir),
        readKimiSessionLog(entry),
      ]);
      return {
        provider: "kimi",
        agentSessionId: entry.agentSessionId,
        project: entry.workDir,
        lastMessage: preview?.lastMessage ?? "",
        timestamp: Math.max(
          parseKimiTimestamp(state?.updatedAt ?? ""),
          parseKimiTimestamp(state?.createdAt ?? ""),
          preview?.timestamp ?? 0,
        ),
      } satisfies SessionSnapshot;
    }),
  );
}

async function loadStoredSessionPreview(agentSessionId: string): Promise<SessionPreview | null> {
  const entry = await findKimiSessionRef(agentSessionId);
  if (!entry) {
    return null;
  }
  return readKimiSessionLog(entry);
}

async function readKimiSessionLog(entry: KimiStoredSessionRef): Promise<SessionPreview | null> {
  const filePath = kimiWireLogPath(entry.sessionDir);
  const log = getSessionLog(filePath);
  const result = await log.reader.read();
  if (result === null) {
    log.preview = null;
    return null;
  }
  if (result.reset) {
    log.preview = null;
  }

  const messages = result.entries.flatMap((raw) => {
    const message = parseKimiConversationMessageEntry(raw);
    return message ? [message] : [];
  });
  for (const message of messages) {
    const lastMessage = normalizePreviewText(message.text);
    if (
      message.role === "assistant" &&
      lastMessage &&
      (!log.preview || message.timestamp >= log.preview.timestamp)
    ) {
      log.preview = {
        lastMessage,
        timestamp: message.timestamp,
      };
    }
  }
  if (!result.reset && messages.length > 0) {
    log.messageListener?.(messages.map((message) => message.text));
  }
  return log.preview;
}

async function watchSessionMessages(
  agentSessionId: string,
  includeExistingMessages: boolean,
  listener: (messages: readonly string[]) => void,
): Promise<() => void> {
  const entry = await findKimiSessionRef(agentSessionId);
  if (!entry) {
    return () => {};
  }
  const filePath = kimiWireLogPath(entry.sessionDir);
  const log = getSessionLog(filePath);
  log.messageListener = null;
  if (includeExistingMessages) {
    await log.reader.reset();
    log.preview = null;
  } else {
    await readKimiSessionLog(entry);
  }
  log.messageListener = listener;
  return () => {
    if (log.messageListener === listener) {
      log.messageListener = null;
    }
  };
}

async function isStoppedByRateLimit(agentSessionId: string): Promise<boolean> {
  const entry = await findKimiSessionRef(agentSessionId);
  return entry === null
    ? false
    : isStoppedAtRateLimit(kimiSessionLogPath(entry.sessionDir), classifyKimiSessionLogLine);
}

async function hasStoredSession(agentSessionId: string): Promise<boolean> {
  return (await findKimiSessionRef(agentSessionId)) !== null;
}

async function loadWorktreeSessionHints(
  worktreePaths: readonly string[],
): Promise<WorktreeSessionHint[]> {
  if (worktreePaths.length === 0) {
    return [];
  }

  const entries = await readKimiSessionIndex();
  const hints: WorktreeSessionHint[] = [];
  for (const entry of entries) {
    const hint = detectKimiWorkDirHint(entry, worktreePaths);
    if (hint) {
      hints.push(hint);
    }
  }

  const sessionsDir = kimiSessionsDir();
  if (!fs.existsSync(sessionsDir)) {
    return hints;
  }

  const refsBySessionDir = new Map(
    entries.map((entry) => [path.resolve(entry.sessionDir), entry] as const),
  );
  await streamRipgrepLineMatches(
    [
      "--fixed-strings",
      "--hidden",
      "--glob",
      "wire.jsonl",
      "--regexp",
      WORKTREE_CONTEXT_PROMPT_MARKER,
      "--",
      sessionsDir,
    ],
    sessionsDir,
    (filePath, lines) => {
      // wire.jsonl lives at <sessionDir>/agents/main/wire.jsonl.
      const sessionDir = path.resolve(path.dirname(filePath), "..", "..");
      const ref = refsBySessionDir.get(sessionDir);
      if (!ref) {
        return;
      }
      hints.push(
        ...detectKimiMentionHints(
          ref,
          lines.map((line) => line.text),
          worktreePaths,
        ),
      );
    },
  );

  return hints;
}

async function waitForSessionId(pending: PendingSession): Promise<string> {
  // The index records workDir realpath-resolved; compare normalized paths.
  const launchWorkDir = normalizeRealPath(pending.launchCwd);
  // The index entry appears right at TUI startup (~1.6s measured), well
  // before the first prompt, so polling for ~15s is ample.
  for (let attempt = 0; attempt < 50; attempt++) {
    const entries = await readKimiSessionIndex();
    const match = entries.find(
      (entry) =>
        !pending.existingAgentSessionIds.has(entry.agentSessionId) &&
        normalizeRealPath(entry.workDir) === launchWorkDir,
    );
    if (match) {
      return match.agentSessionId;
    }
    if (pending.exited) {
      throw new Error("Kimi exited before creating a session");
    }
    await setTimeout(300);
  }
  throw new Error("Timeout waiting for Kimi session initialization");
}

async function hasRecordedInitialInput(
  agentSessionId: string,
  initialInput: string,
): Promise<boolean> {
  const entry = await findKimiSessionRef(agentSessionId);
  if (!entry) {
    return false;
  }
  const content = await readTextFileIfExists(kimiWireLogPath(entry.sessionDir));
  if (!content) {
    return false;
  }
  // Kimi trims the editor value when it submits a user message.
  const recordedInput = initialInput.trim();
  // The wire log stores messages as JSON; check both the raw text and its
  // JSON-escaped form so prompts with quotes or newlines still match.
  return (
    content.includes(recordedInput) || content.includes(JSON.stringify(recordedInput).slice(1, -1))
  );
}

export const agent: Agent = {
  definition: {
    id: "kimi",
    label: "Kimi",
  },
  command: "kimi",
  resolvesSessionIdLazily: false,
  loadStoredSessions,
  loadStoredSessionPreview,
  watchSessionMessages,
  loadWorktreeSessionHints,
  hasStoredSession,
  isStoppedByRateLimit,
  loadPlanUsage: loadKimiPlanUsage,
  async createResumeLaunch(session) {
    // kimi refuses to resume unless the process cwd equals the session's
    // recorded workDir, so resume exactly where the session was recorded.
    return {
      cwd: session.cwd,
      args: ["--session", session.agentSessionId],
      worktreePath: session.project,
    };
  },
  async createWorktreeLaunch(context) {
    // kimi has no --append-system-prompt equivalent, so the worktree context
    // prompt is delivered as the first user message typed into the PTY.
    return {
      cwd: context.repoPath,
      args: context.model === undefined ? [] : ["--model", context.model],
      worktreePath: context.worktreePath,
      initialInput: await loadWorktreeContextPrompt(context),
      initialPrompt:
        context.initialPrompt === undefined ? undefined : toKimiUserMessage(context.initialPrompt),
      existingAgentSessionIds: await listExistingSessionIds(),
    };
  },
  waitForSessionId,
  hasRecordedInitialInput,
};
