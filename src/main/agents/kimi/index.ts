import { setTimeout } from "node:timers/promises";
import fs from "fs";
import path from "path";
import { streamRipgrepLineMatches } from "../../ripgrep.js";
import type { PendingSession, SessionPreview, Agent, SessionSnapshot } from "../agent.js";
import { SessionLogWatcher, type ConversationMessage } from "../session-log-watcher.js";
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
  title: string;
  lastPrompt: string;
  createdAt: string;
  updatedAt: string;
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
    title?: unknown;
    lastPrompt?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  };
  return {
    title: typeof maybeState.title === "string" ? maybeState.title : "",
    lastPrompt: typeof maybeState.lastPrompt === "string" ? maybeState.lastPrompt : "",
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

function toSessionPreview(state: KimiSessionState): SessionPreview {
  return {
    lastMessage: state.lastPrompt || state.title,
    timestamp: Math.max(parseKimiTimestamp(state.updatedAt), parseKimiTimestamp(state.createdAt)),
  };
}

// wire.jsonl の record を会話メッセージへ変換する。bookmark 取得にだけ使い、
// preview は従来どおり state.json から読む。wire.jsonl の record は timestamp を
// 持たないため 0 を入れる (preview に使われないので問題にならない)。
function parseKimiConversationMessageEntry(entry: unknown): ConversationMessage | null {
  const maybeEntry = entry as {
    type?: unknown;
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
    return text ? { role: "user", text, timestamp: 0 } : null;
  }
  if (
    maybeEntry?.type === "context.append_loop_event" &&
    maybeEntry.event?.type === "content.part" &&
    maybeEntry.event.part?.type === "text" &&
    typeof maybeEntry.event.part.text === "string"
  ) {
    return { role: "assistant", text: maybeEntry.event.part.text, timestamp: 0 };
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

const sessionLogWatcher = new SessionLogWatcher(parseKimiConversationMessageEntry);

async function listExistingSessionIds(): Promise<Set<string>> {
  return new Set((await readKimiSessionIndex()).map((entry) => entry.agentSessionId));
}

async function loadStoredSessions(): Promise<SessionSnapshot[]> {
  const entries = await readKimiSessionIndex();
  return Promise.all(
    entries.map(async (entry) => {
      const state = await readKimiSessionState(entry.sessionDir);
      return {
        provider: "kimi",
        agentSessionId: entry.agentSessionId,
        project: entry.workDir,
        lastMessage: state ? toSessionPreview(state).lastMessage : "",
        timestamp: state ? toSessionPreview(state).timestamp : 0,
      } satisfies SessionSnapshot;
    }),
  );
}

async function loadStoredSessionPreview(agentSessionId: string): Promise<SessionPreview | null> {
  const entry = await findKimiSessionRef(agentSessionId);
  if (!entry) {
    return null;
  }
  const [state] = await Promise.all([
    readKimiSessionState(entry.sessionDir),
    readKimiSessionMessages(entry),
  ]);
  return state ? toSessionPreview(state) : null;
}

// preview は state.json から読むため返り値は使わず、watch 中の listener への
// メッセージ通知という副作用のために読む。listener がいなければ読まない
// (bookmark の自動追加が無効なときに wire.jsonl を読む必要がない)。
async function readKimiSessionMessages(entry: KimiStoredSessionRef): Promise<void> {
  const wireLogPath = kimiWireLogPath(entry.sessionDir);
  if (!sessionLogWatcher.hasListeners(wireLogPath)) {
    return;
  }
  await sessionLogWatcher.read(wireLogPath);
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
  return sessionLogWatcher.watch(
    kimiWireLogPath(entry.sessionDir),
    includeExistingMessages,
    listener,
  );
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
