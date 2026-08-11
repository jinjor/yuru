import {
  resolveContainingWorktreePath,
  type WorktreeSessionHint,
} from "../../sessions/detection.js";

interface ClaudeCwdEntry {
  sessionId: string;
  cwd: string;
}

interface JsonLineEntry {
  entry: unknown;
  lineIndex: number;
}

export interface ClaudeSessionLine {
  text: string;
  lineIndex: number;
}

interface ClaudeWorktreeEvidence {
  agentSessionId: string;
  worktreePath: string;
  evidenceRank: number;
  sequence: number;
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

function parseJsonLineEntries(lines: readonly ClaudeSessionLine[]): JsonLineEntry[] {
  return lines.flatMap((line) => {
    if (!line.text) {
      return [];
    }
    try {
      return [{ entry: JSON.parse(line.text) as unknown, lineIndex: line.lineIndex }];
    } catch {
      return [];
    }
  });
}

function parseContentLines(content: string): ClaudeSessionLine[] {
  return content
    .split("\n")
    .flatMap((line, index) => (line ? [{ text: line, lineIndex: index }] : []));
}

function readSessionId(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const maybeEntry = entry as { sessionId?: unknown };
  return typeof maybeEntry.sessionId === "string" ? maybeEntry.sessionId : null;
}

function readToolUseFilePaths(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(readToolUseFilePaths);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const maybeToolUse = value as {
    type?: unknown;
    input?: {
      file_path?: unknown;
    };
  };
  const ownFilePath =
    maybeToolUse.type === "tool_use" && typeof maybeToolUse.input?.file_path === "string"
      ? [maybeToolUse.input.file_path]
      : [];
  return [
    ...ownFilePath,
    ...Object.values(value as Record<string, unknown>).flatMap(readToolUseFilePaths),
  ];
}

export function detectClaudeWorktreeSession(
  content: string,
  worktreePaths: readonly string[],
): WorktreeSessionHint | null {
  return detectClaudeWorktreeSessions(content, worktreePaths)[0] ?? null;
}

export function detectClaudeWorktreeSessions(
  content: string,
  worktreePaths: readonly string[],
): WorktreeSessionHint[] {
  return detectClaudeWorktreeSessionLines(parseContentLines(content), worktreePaths);
}

export function detectClaudeWorktreeSessionLines(
  lines: readonly ClaudeSessionLine[],
  worktreePaths: readonly string[],
): WorktreeSessionHint[] {
  const evidencesByKey = new Map<string, ClaudeWorktreeEvidence>();
  const entries = parseJsonLineEntries(lines);

  const addEvidence = (
    agentSessionId: string,
    worktreePath: string,
    evidenceRank: number,
    sequence: number,
  ): void => {
    const evidence = { agentSessionId, worktreePath, evidenceRank, sequence };
    const key = `${agentSessionId}:${worktreePath}`;
    const existing = evidencesByKey.get(key);
    if (existing && compareClaudeWorktreeEvidence(evidence, existing) >= 0) {
      return;
    }
    evidencesByKey.set(key, evidence);
  };

  for (const line of entries) {
    const entry = parseClaudeCwdEntry(line.entry);
    if (!entry) {
      continue;
    }
    const worktreePath = resolveContainingWorktreePath(entry.cwd, worktreePaths);
    if (worktreePath) {
      addEvidence(entry.sessionId, worktreePath, 0, line.lineIndex);
    }
  }

  for (const line of entries) {
    const sessionId = readSessionId(line.entry);
    if (!sessionId) {
      continue;
    }
    for (const filePath of readToolUseFilePaths(line.entry)) {
      const worktreePath = resolveContainingWorktreePath(filePath, worktreePaths);
      if (worktreePath) {
        addEvidence(sessionId, worktreePath, 1, line.lineIndex);
      }
    }
  }

  return Array.from(evidencesByKey.values())
    .sort(compareClaudeWorktreeEvidence)
    .map(
      (evidence, worktreeRank) =>
        ({
          provider: "claude",
          agentSessionId: evidence.agentSessionId,
          worktreePath: evidence.worktreePath,
          worktreeRank,
        }) satisfies WorktreeSessionHint,
    );
}

function compareClaudeWorktreeEvidence(
  a: ClaudeWorktreeEvidence,
  b: ClaudeWorktreeEvidence,
): number {
  const evidenceOrder = a.evidenceRank - b.evidenceRank;
  if (evidenceOrder !== 0) {
    return evidenceOrder;
  }
  const recencyOrder = b.sequence - a.sequence;
  if (recencyOrder !== 0) {
    return recencyOrder;
  }
  const sessionOrder = a.agentSessionId.localeCompare(b.agentSessionId);
  if (sessionOrder !== 0) {
    return sessionOrder;
  }
  return a.worktreePath.localeCompare(b.worktreePath);
}
