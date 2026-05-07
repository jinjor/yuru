import { parseJsonLinesAs } from "../../agent-store-utils.js";
import {
  resolveContainingWorktreePath,
  type WorktreeSessionHint,
} from "../../worktree-session-detection.js";

interface CodexSessionMetaCwd {
  providerSessionId: string;
  cwd: string;
}

interface CodexExecCommandEndCwd {
  cwd: string;
}

function parseCodexSessionMetaCwd(entry: unknown): CodexSessionMetaCwd | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const maybeEntry = entry as {
    type?: unknown;
    payload?: {
      id?: unknown;
      cwd?: unknown;
    };
  };

  if (maybeEntry.type !== "session_meta" || !maybeEntry.payload) {
    return null;
  }

  if (typeof maybeEntry.payload.id !== "string" || typeof maybeEntry.payload.cwd !== "string") {
    return null;
  }

  return {
    providerSessionId: maybeEntry.payload.id,
    cwd: maybeEntry.payload.cwd,
  };
}

function parseCodexExecCommandEndCwd(entry: unknown): CodexExecCommandEndCwd | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const maybeEntry = entry as {
    type?: unknown;
    payload?: {
      type?: unknown;
      cwd?: unknown;
    };
  };

  if (maybeEntry.type !== "event_msg" || maybeEntry.payload?.type !== "exec_command_end") {
    return null;
  }

  if (typeof maybeEntry.payload.cwd !== "string") {
    return null;
  }

  return {
    cwd: maybeEntry.payload.cwd,
  };
}

export function detectCodexWorktreeSession(
  content: string,
  worktreePaths: readonly string[],
): WorktreeSessionHint | null {
  const sessionMeta = parseJsonLinesAs(content, parseCodexSessionMetaCwd)[0];
  if (!sessionMeta) {
    return null;
  }

  const sessionWorktreePath = resolveContainingWorktreePath(sessionMeta.cwd, worktreePaths);
  if (sessionWorktreePath) {
    return {
      provider: "codex",
      providerSessionId: sessionMeta.providerSessionId,
      worktreePath: sessionWorktreePath,
      source: "codex-session-meta",
    };
  }

  for (const entry of parseJsonLinesAs(content, parseCodexExecCommandEndCwd)) {
    const worktreePath = resolveContainingWorktreePath(entry.cwd, worktreePaths);
    if (worktreePath) {
      return {
        provider: "codex",
        providerSessionId: sessionMeta.providerSessionId,
        worktreePath,
        source: "codex-exec-command-end",
      };
    }
  }

  return null;
}
