import { setTimeout } from "node:timers/promises";
import type { PendingSession, SessionPreview, Agent, SessionSnapshot } from "../agent.js";
import {
  normalizeRealPath,
  resolveMentionedWorktreePaths,
  type WorktreeSessionHint,
} from "../session-detection.js";
import {
  loadWorktreeContextPrompt,
  WORKTREE_CONTEXT_PROMPT_MARKER,
} from "../worktree-context-prompt.js";
import { loadDevinPlanUsage } from "./plan-usage.js";
import { detectDevinMentionHints, detectDevinWorkDirHint } from "./session-detection.js";
import {
  hasSessionRow,
  listSessionIds,
  readLastAssistantMessage,
  readMarkerUserMessages,
  readSessionRow,
  readSessionRows,
  readUserMessageContents,
  withDevinStore,
} from "./store.js";

const SESSION_POLL_INTERVAL_MS = 500;
// sessions.created_at has one-second resolution, so the launch timestamp needs
// a margin to not exclude a session created within the same second.
const SESSION_STARTED_MARGIN_MS = 2_000;

// devin takes the whole request as its first user message. kimi, which has to
// type both messages into the PTY, separates the context from the task with
// this prefix; devin joins them into the single launch prompt instead.
const USER_MESSAGE_PREFIX = "User request:\n\n";

function toFirstUserMessage(contextPrompt: string, initialPrompt: string | undefined): string {
  return initialPrompt === undefined
    ? contextPrompt
    : `${contextPrompt}\n\n${USER_MESSAGE_PREFIX}${initialPrompt}`;
}

async function loadStoredSessions(): Promise<SessionSnapshot[]> {
  return withDevinStore(
    (db) =>
      readSessionRows(db).map((row) => {
        const preview = readLastAssistantMessage(db, row.agentSessionId);
        return {
          provider: "devin" as const,
          agentSessionId: row.agentSessionId,
          project: row.workDir,
          lastMessage: preview?.text ?? row.title,
          timestamp: Math.max(row.lastActivityAt, preview?.timestamp ?? 0),
        };
      }),
    [],
  );
}

async function loadStoredSessionPreview(agentSessionId: string): Promise<SessionPreview | null> {
  return withDevinStore((db) => {
    const message = readLastAssistantMessage(db, agentSessionId);
    if (message) {
      return { lastMessage: message.text, timestamp: message.timestamp };
    }
    const row = readSessionRow(db, agentSessionId);
    return row ? { lastMessage: row.title, timestamp: row.lastActivityAt } : null;
  }, null);
}

async function loadWorktreeSessionHints(
  worktreePaths: readonly string[],
): Promise<WorktreeSessionHint[]> {
  if (worktreePaths.length === 0) {
    return [];
  }
  return withDevinStore((db) => {
    const hints: WorktreeSessionHint[] = [];
    const rows = readSessionRows(db);
    // Mention hints must be limited to the same sessions the listing shows —
    // readSessionRows already excludes hidden sessions, so its ids are the
    // visible set. A hidden session's recorded context would otherwise still
    // surface it as a suggested session.
    const visibleIds = new Set(rows.map((row) => row.agentSessionId));
    for (const row of rows) {
      const hint = detectDevinWorkDirHint(row.agentSessionId, row.workDir, worktreePaths);
      if (hint) {
        hints.push(hint);
      }
    }
    for (const [sessionId, contents] of readMarkerUserMessages(
      db,
      WORKTREE_CONTEXT_PROMPT_MARKER,
    )) {
      if (!visibleIds.has(sessionId)) {
        continue;
      }
      hints.push(...detectDevinMentionHints(sessionId, contents, worktreePaths));
    }
    return hints;
  }, []);
}

async function hasStoredSession(agentSessionId: string): Promise<boolean> {
  return withDevinStore((db) => hasSessionRow(db, agentSessionId), false);
}

// The session a launch created is the new one under its working directory that
// recorded the injected context: the context names the worktree, so launches
// for different worktrees never match each other's session even though they
// all run devin in the repository root. The wait has no deadline of its own —
// a trust or login screen can hold the launch before the session exists, and
// only the process exiting ends it.
async function waitForSessionId(pending: PendingSession): Promise<string> {
  const launchWorkDir = normalizeRealPath(pending.launchCwd);
  for (;;) {
    const found = withDevinStore((db) => {
      const candidates = readSessionRows(db).filter(
        (row) =>
          !pending.existingAgentSessionIds.has(row.agentSessionId) &&
          row.createdAt >= pending.startedAt - SESSION_STARTED_MARGIN_MS &&
          normalizeRealPath(row.workDir) === launchWorkDir,
      );
      return (
        candidates.find((candidate) =>
          readUserMessageContents(db, candidate.agentSessionId).some(
            (content) => resolveMentionedWorktreePaths(content, [pending.worktreePath]).length > 0,
          ),
        )?.agentSessionId ?? null
      );
    }, null);
    if (found !== null) {
      return found;
    }
    if (pending.exited) {
      throw new Error("Devin exited before creating a session");
    }
    await setTimeout(SESSION_POLL_INTERVAL_MS);
  }
}

export const agent: Agent = {
  definition: {
    id: "devin",
    label: "Devin",
  },
  command: "devin",
  // The terminal is usable before the session id resolves, which keeps devin's
  // workspace-trust and login screens answerable during startup.
  resolvesSessionIdLazily: true,
  loadStoredSessions,
  loadStoredSessionPreview,
  loadWorktreeSessionHints,
  hasStoredSession,
  loadPlanUsage: loadDevinPlanUsage,
  async createResumeLaunch(session) {
    return {
      cwd: session.cwd,
      args: ["--resume", session.agentSessionId],
      worktreePath: session.project,
    };
  },
  async createWorktreeLaunch(context) {
    // devin has no --append-system-prompt equivalent; the worktree context goes
    // as the first user message through the positional prompt. `--` keeps a
    // prompt with option-looking words in the prompt operand, and the user's
    // initial request rides in the same first message.
    const prompt = await loadWorktreeContextPrompt(context);
    const args: string[] = [];
    if (context.model !== undefined) {
      args.push("--model", context.model);
    }
    args.push("--", toFirstUserMessage(prompt, context.initialPrompt));
    return {
      cwd: context.repoPath,
      args,
      worktreePath: context.worktreePath,
      existingAgentSessionIds: withDevinStore((db) => listSessionIds(db), new Set<string>()),
    };
  },
  waitForSessionId,
};
