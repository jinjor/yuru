import { parseJsonLinesAs } from "../../agent-store-utils.js";
import {
  resolveContainingWorktreePath,
  type WorktreeSessionHint,
} from "../../worktree-session-detection.js";

interface ClaudeCwdEntry {
  sessionId: string;
  cwd: string;
}

function parseClaudeWorktreeStateHint(entry: unknown): WorktreeSessionHint | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const maybeEntry = entry as {
    type?: unknown;
    sessionId?: unknown;
    worktreeSession?: {
      sessionId?: unknown;
      worktreePath?: unknown;
    };
  };

  if (maybeEntry.type !== "worktree-state") {
    return null;
  }

  const providerSessionId =
    typeof maybeEntry.sessionId === "string"
      ? maybeEntry.sessionId
      : maybeEntry.worktreeSession && typeof maybeEntry.worktreeSession.sessionId === "string"
        ? maybeEntry.worktreeSession.sessionId
        : null;

  if (!providerSessionId || typeof maybeEntry.worktreeSession?.worktreePath !== "string") {
    return null;
  }

  return {
    provider: "claude",
    providerSessionId,
    worktreePath: maybeEntry.worktreeSession.worktreePath,
    worktreeRank: 0,
  };
}

function parseClaudeCwdEntry(entry: unknown): ClaudeCwdEntry | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const maybeEntry = entry as {
    sessionId?: unknown;
    cwd?: unknown;
  };

  if (typeof maybeEntry.sessionId !== "string" || typeof maybeEntry.cwd !== "string") {
    return null;
  }

  return {
    sessionId: maybeEntry.sessionId,
    cwd: maybeEntry.cwd,
  };
}

export function detectClaudeWorktreeSession(
  content: string,
  worktreePaths: readonly string[],
): WorktreeSessionHint | null {
  const worktreeStateHint = parseJsonLinesAs(content, parseClaudeWorktreeStateHint)[0];
  if (worktreeStateHint) {
    return worktreeStateHint;
  }

  for (const entry of parseJsonLinesAs(content, parseClaudeCwdEntry)) {
    const worktreePath = resolveContainingWorktreePath(entry.cwd, worktreePaths);
    if (worktreePath) {
      return {
        provider: "claude",
        providerSessionId: entry.sessionId,
        worktreePath,
        worktreeRank: 0,
      };
    }
  }

  return null;
}
