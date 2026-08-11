import { setTimeout } from "node:timers/promises";
import fs from "fs";
import path from "path";
import { streamRipgrepLineMatches } from "../../ripgrep.js";
import type {
  PendingSession,
  SessionPreview,
  SessionProviderAdapter,
  SessionSnapshot,
} from "../agent.js";
import { parseJsonLinesAs, readTextFileIfExists } from "../store-utils.js";
import type { WorktreeSessionHint } from "../../sessions/detection.js";
import {
  loadWorktreeContextPrompt,
  WORKTREE_CONTEXT_PROMPT_MARKER,
} from "../../sessions/context-prompt.js";
import { assertValidTerminalInput } from "../../terminal/initial-input.js";
import {
  kimiSessionIndexPath,
  kimiSessionStatePath,
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
    providerSessionId: maybeEntry.sessionId,
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
    sessionRefsById.set(entry.providerSessionId, entry);
  }
  return entries;
}

async function findKimiSessionRef(providerSessionId: string): Promise<KimiStoredSessionRef | null> {
  const cached = sessionRefsById.get(providerSessionId);
  if (cached && fs.existsSync(cached.sessionDir)) {
    return cached;
  }
  const entry = (await readKimiSessionIndex()).find(
    (candidate) => candidate.providerSessionId === providerSessionId,
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

async function listExistingSessionIds(): Promise<Set<string>> {
  return new Set((await readKimiSessionIndex()).map((entry) => entry.providerSessionId));
}

async function loadStoredSessions(): Promise<SessionSnapshot[]> {
  const entries = await readKimiSessionIndex();
  return Promise.all(
    entries.map(async (entry) => {
      const state = await readKimiSessionState(entry.sessionDir);
      return {
        provider: "kimi",
        providerSessionId: entry.providerSessionId,
        project: entry.workDir,
        lastMessage: state ? toSessionPreview(state).lastMessage : "",
        timestamp: state ? toSessionPreview(state).timestamp : 0,
      } satisfies SessionSnapshot;
    }),
  );
}

async function loadStoredSessionPreview(providerSessionId: string): Promise<SessionPreview | null> {
  const entry = await findKimiSessionRef(providerSessionId);
  if (!entry) {
    return null;
  }
  const state = await readKimiSessionState(entry.sessionDir);
  return state ? toSessionPreview(state) : null;
}

async function hasStoredSession(providerSessionId: string): Promise<boolean> {
  return (await findKimiSessionRef(providerSessionId)) !== null;
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
        !pending.existingProviderSessionIds.has(entry.providerSessionId) &&
        normalizeRealPath(entry.workDir) === launchWorkDir,
    );
    if (match) {
      return match.providerSessionId;
    }
    if (pending.exited) {
      throw new Error("Kimi exited before creating a session");
    }
    await setTimeout(300);
  }
  throw new Error("Timeout waiting for Kimi session initialization");
}

async function hasRecordedInitialInput(
  providerSessionId: string,
  initialInput: string,
): Promise<boolean> {
  const entry = await findKimiSessionRef(providerSessionId);
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

export const sessionProvider: SessionProviderAdapter = {
  definition: {
    id: "kimi",
    label: "Kimi",
  },
  command: "kimi",
  resolvesSessionIdLazily: false,
  loadStoredSessions,
  loadStoredSessionPreview,
  loadWorktreeSessionHints,
  hasStoredSession,
  loadPlanUsage: loadKimiPlanUsage,
  async createResumeLaunch(session) {
    // kimi refuses to resume unless the process cwd equals the session's
    // recorded workDir, so resume exactly where the session was recorded.
    return {
      cwd: session.cwd,
      args: ["--session", session.providerSessionId],
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
      existingProviderSessionIds: await listExistingSessionIds(),
    };
  },
  waitForSessionId,
  hasRecordedInitialInput,
};
