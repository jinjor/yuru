import path from "path";

export type WorktreeSessionHintSource =
  | "claude-worktree-state"
  | "claude-cwd"
  | "codex-session-meta"
  | "codex-exec-command-end";

export interface WorktreeSessionHint {
  provider: "claude" | "codex";
  providerSessionId: string;
  worktreePath: string;
  source: WorktreeSessionHintSource;
}

interface ClaudeCwdEntry {
  sessionId: string;
  cwd: string;
}

interface CodexSessionMetaCwd {
  providerSessionId: string;
  cwd: string;
}

interface CodexExecCommandEndCwd {
  cwd: string;
}

function parseJsonLinesAs<T>(
  content: string,
  parser: (entry: unknown) => T | null,
): T[] {
  return content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = parser(JSON.parse(line));
        return parsed ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

function isSamePathOrChild(parentPath: string, maybeChildPath: string): boolean {
  const relativePath = path.relative(parentPath, maybeChildPath);
  return (
    relativePath === "" ||
    (!!relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

export function resolveContainingWorktreePath(
  cwd: string,
  worktreePaths: readonly string[],
): string | null {
  const resolvedCwd = path.resolve(cwd);
  const matches = worktreePaths
    .map((worktreePath) => ({
      original: worktreePath,
      resolved: path.resolve(worktreePath),
    }))
    .filter((worktree) => isSamePathOrChild(worktree.resolved, resolvedCwd))
    .sort((a, b) => b.resolved.length - a.resolved.length);

  return matches[0]?.original ?? null;
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
    source: "claude-worktree-state",
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
        source: "claude-cwd",
      };
    }
  }

  return null;
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
