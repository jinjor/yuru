import { setTimeout } from "node:timers/promises";
import fs from "fs";
import path from "path";
import { streamRipgrepLineMatches } from "../../ripgrep.js";
import type { Agent, PendingSession, SessionPreview, SessionSnapshot } from "../agent.js";
import { SessionLogWatcher, type PreviewMessage } from "../session-log-watcher.js";
import {
  normalizeRealPath,
  normalizeWorktreePaths,
  resolveMentionedWorktreePaths,
  type WorktreeSessionHint,
} from "../session-detection.js";
import { readTextFileIfExists } from "../store-utils.js";
import {
  loadWorktreeContextPrompt,
  USER_REQUEST_PREFIX,
  WORKTREE_CONTEXT_PROMPT_MARKER,
} from "../worktree-context-prompt.js";
import { antigravityBrainDir, antigravityTranscriptPath } from "./paths.js";
import { loadAntigravityPlanUsage } from "./plan-usage.js";
import {
  detectAntigravityMentionHints,
  detectAntigravityWorkDirHint,
  extractUserInputContent,
} from "./session-detection.js";
import {
  hasSessionRow,
  listSessionIds,
  readSessionRow,
  readSessionRows,
  withAntigravityStore,
} from "./store.js";

const SESSION_POLL_INTERVAL_MS = 500;
const SESSION_STARTED_MARGIN_MS = 2_000;

function parseAntigravityPreviewMessageEntry(entry: unknown): PreviewMessage | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const message = entry as {
    type?: unknown;
    content?: unknown;
    created_at?: unknown;
  };
  if (message.type !== "PLANNER_RESPONSE" || typeof message.content !== "string") {
    return null;
  }
  if (!message.content.trim()) {
    return null;
  }
  return {
    text: message.content,
    timestamp: parseIsoTimestamp(message.created_at),
  };
}

function parseIsoTimestamp(raw: unknown): number {
  if (typeof raw !== "string" || !raw) {
    return 0;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

const sessionLogWatcher = new SessionLogWatcher(parseAntigravityPreviewMessageEntry);

function toFirstUserMessage(contextPrompt: string, initialPrompt: string | undefined): string {
  return initialPrompt === undefined
    ? contextPrompt
    : `${contextPrompt}\n\n${USER_REQUEST_PREFIX}${initialPrompt}`;
}

async function readTranscriptPreview(agentSessionId: string): Promise<SessionPreview | null> {
  const transcriptPath = antigravityTranscriptPath(agentSessionId);
  if (!fs.existsSync(transcriptPath)) {
    return null;
  }
  return sessionLogWatcher.read(transcriptPath);
}

async function loadStoredSessions(): Promise<SessionSnapshot[]> {
  const rows = withAntigravityStore((db) => readSessionRows(db), []);
  return Promise.all(
    rows.map(async (row) => {
      const preview = await readTranscriptPreview(row.agentSessionId);
      return {
        provider: "antigravity" as const,
        agentSessionId: row.agentSessionId,
        project: row.workDir,
        lastMessage: preview?.lastMessage || row.title || row.preview,
        timestamp: Math.max(row.lastModifiedAt, preview?.timestamp ?? 0),
      };
    }),
  );
}

async function loadStoredSessionPreview(agentSessionId: string): Promise<SessionPreview | null> {
  const preview = await readTranscriptPreview(agentSessionId);
  if (preview) {
    return preview;
  }
  const row = withAntigravityStore((db) => readSessionRow(db, agentSessionId), null);
  return row ? { lastMessage: row.title || row.preview, timestamp: row.lastModifiedAt } : null;
}

async function hasStoredSession(agentSessionId: string): Promise<boolean> {
  return withAntigravityStore((db) => hasSessionRow(db, agentSessionId), false);
}

async function loadWorktreeSessionHints(
  worktreePaths: readonly string[],
): Promise<WorktreeSessionHint[]> {
  if (worktreePaths.length === 0) {
    return [];
  }
  const rows = withAntigravityStore((db) => readSessionRows(db), []);
  const hints: WorktreeSessionHint[] = [];
  const worktrees = normalizeWorktreePaths(worktreePaths);
  const visibleIds = new Set(rows.map((row) => row.agentSessionId));

  for (const row of rows) {
    const hint = detectAntigravityWorkDirHint(row.agentSessionId, row.workspaceDirs, worktrees);
    if (hint) {
      hints.push(hint);
    }
  }

  const brainDir = antigravityBrainDir();
  if (!fs.existsSync(brainDir) || visibleIds.size === 0) {
    return hints;
  }

  await streamRipgrepLineMatches(
    [
      "--fixed-strings",
      "--hidden",
      "--glob",
      "transcript.jsonl",
      "--regexp",
      WORKTREE_CONTEXT_PROMPT_MARKER,
      "--",
      brainDir,
    ],
    brainDir,
    (filePath, lines) => {
      // transcript.jsonl lives at <brainDir>/<conversationId>/.system_generated/logs/transcript.jsonl.
      const conversationId = extractConversationIdFromTranscriptPath(brainDir, filePath);
      if (conversationId === null || !visibleIds.has(conversationId)) {
        return;
      }
      hints.push(
        ...detectAntigravityMentionHints(
          conversationId,
          lines.map((line) => line.text),
          worktreePaths,
        ),
      );
    },
  );

  return hints;
}

function extractConversationIdFromTranscriptPath(
  brainDir: string,
  filePath: string,
): string | null {
  const relative = path.relative(brainDir, filePath);
  const parts = relative.split(path.sep);
  if (
    parts.length !== 4 ||
    parts[1] !== ".system_generated" ||
    parts[2] !== "logs" ||
    parts[3] !== "transcript.jsonl"
  ) {
    return null;
  }
  return parts[0] || null;
}

async function hasWorktreeMentionInTranscript(
  agentSessionId: string,
  worktreePath: string,
): Promise<boolean> {
  const content = await readTextFileIfExists(antigravityTranscriptPath(agentSessionId));
  if (!content) {
    return false;
  }
  for (const line of content.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const userContent = extractUserInputContent(line);
    if (
      userContent !== null &&
      resolveMentionedWorktreePaths(userContent, [worktreePath]).length > 0
    ) {
      return true;
    }
  }
  return false;
}

// The session a launch created is the new top-level conversation under its
// launch working directory whose transcript recorded the injected context.
// Because the context names the worktree, concurrent launches for different
// worktrees of the same repo never match each other's session. The wait has no
// deadline of its own so login/trust screens remain answerable until exit.
async function waitForSessionId(pending: PendingSession): Promise<string> {
  const launchWorkDir = normalizeRealPath(pending.launchCwd);
  for (;;) {
    const candidates = withAntigravityStore(
      (db) =>
        readSessionRows(db).filter(
          (row) =>
            !pending.existingAgentSessionIds.has(row.agentSessionId) &&
            (row.lastModifiedAt === 0 ||
              row.lastModifiedAt >= pending.startedAt - SESSION_STARTED_MARGIN_MS) &&
            row.workspaceDirs.some((dir) => normalizeRealPath(dir) === launchWorkDir),
        ),
      [],
    );
    for (const candidate of candidates) {
      if (await hasWorktreeMentionInTranscript(candidate.agentSessionId, pending.worktreePath)) {
        return candidate.agentSessionId;
      }
    }
    if (pending.exited) {
      throw new Error("Antigravity exited before creating a session");
    }
    await setTimeout(SESSION_POLL_INTERVAL_MS);
  }
}

export const agent: Agent = {
  definition: {
    id: "antigravity",
    label: "Antigravity",
  },
  command: "agy",
  // The terminal is usable before the session id resolves, which keeps login
  // and workspace-trust screens answerable during startup.
  resolvesSessionIdLazily: true,
  loadStoredSessions,
  loadStoredSessionPreview,
  loadWorktreeSessionHints,
  hasStoredSession,
  loadPlanUsage: loadAntigravityPlanUsage,
  async createResumeLaunch(session) {
    return {
      cwd: session.cwd,
      args: ["--conversation", session.agentSessionId],
      worktreePath: session.project,
    };
  },
  async createWorktreeLaunch(context) {
    // agy has no --append-system-prompt equivalent; the worktree context goes
    // as the first user message via --prompt-interactive, with the user's
    // initial request joined into the same message when present.
    const prompt = await loadWorktreeContextPrompt(context);
    const args: string[] = [];
    if (context.model !== undefined) {
      args.push("--model", context.model);
    }
    args.push("--prompt-interactive", toFirstUserMessage(prompt, context.initialPrompt));
    return {
      cwd: context.repoPath,
      args,
      worktreePath: context.worktreePath,
      existingAgentSessionIds: withAntigravityStore((db) => listSessionIds(db), new Set<string>()),
    };
  },
  waitForSessionId,
};
