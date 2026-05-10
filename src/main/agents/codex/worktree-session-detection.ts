import path from "path";
import { parseJsonLinesAs } from "../../agent-store-utils.js";
import {
  resolveContainingWorktreePath,
  type WorktreeSessionHint,
} from "../../worktree-session-detection.js";

export interface CodexSessionMetaCwd {
  providerSessionId: string;
  cwd: string;
}

interface CodexExecCommandEndCwd {
  cwd: string;
}

interface CodexFunctionCallWorkdir {
  workdir: string;
}

interface CodexPatchApplyChanges {
  changedPaths: string[];
}

interface JsonLineEntry {
  entry: unknown;
  lineIndex: number;
}

export interface CodexSessionLine {
  text: string;
  lineIndex: number;
}

interface CodexWorktreeEvidence {
  worktreePath: string;
  evidenceRank: number;
  sequence: number;
}

interface CodexWorktreePathMention {
  worktreePath: string;
  sequence: number;
}

const CODEX_EVIDENCE_RANK = {
  primary: 0,
  patch: 1,
  cwd: 2,
  text: 3,
} as const;

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

function parseCodexFunctionCallWorkdir(entry: unknown): CodexFunctionCallWorkdir | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const maybeEntry = entry as {
    type?: unknown;
    payload?: {
      type?: unknown;
      name?: unknown;
      arguments?: unknown;
    };
  };

  if (
    maybeEntry.type !== "response_item" ||
    maybeEntry.payload?.type !== "function_call" ||
    maybeEntry.payload.name !== "exec_command" ||
    typeof maybeEntry.payload.arguments !== "string"
  ) {
    return null;
  }

  try {
    const args = JSON.parse(maybeEntry.payload.arguments) as { workdir?: unknown };
    if (typeof args.workdir !== "string") {
      return null;
    }
    return { workdir: args.workdir };
  } catch {
    return null;
  }
}

function parseCodexPatchApplyChanges(entry: unknown): CodexPatchApplyChanges | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const maybeEntry = entry as {
    type?: unknown;
    payload?: {
      type?: unknown;
      changes?: unknown;
    };
  };

  if (maybeEntry.type !== "event_msg" || maybeEntry.payload?.type !== "patch_apply_end") {
    return null;
  }
  if (
    !maybeEntry.payload.changes ||
    typeof maybeEntry.payload.changes !== "object" ||
    Array.isArray(maybeEntry.payload.changes)
  ) {
    return null;
  }

  return {
    changedPaths: Object.keys(maybeEntry.payload.changes),
  };
}

function parseJsonLineEntries(lines: readonly CodexSessionLine[]): JsonLineEntry[] {
  return lines
    .flatMap((line) => {
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

function parseContentLines(content: string): CodexSessionLine[] {
  return content
    .split("\n")
    .flatMap((line, index) => (line ? [{ text: line, lineIndex: index }] : []));
}

export function detectCodexWorktreeSession(
  content: string,
  worktreePaths: readonly string[],
): WorktreeSessionHint | null {
  return detectCodexWorktreeSessions(content, worktreePaths)[0] ?? null;
}

export function detectCodexWorktreeSessions(
  content: string,
  worktreePaths: readonly string[],
): WorktreeSessionHint[] {
  const sessionMeta = parseJsonLinesAs(content, parseCodexSessionMetaCwd)[0];
  if (!sessionMeta) {
    return [];
  }

  return detectCodexWorktreeSessionEntries(
    sessionMeta,
    parseJsonLineEntries(parseContentLines(content)),
    resolveMentionedWorktreePathMentions(content, worktreePaths),
    worktreePaths,
  );
}

export function detectCodexWorktreeSessionLines(
  sessionMeta: CodexSessionMetaCwd,
  lines: readonly CodexSessionLine[],
  worktreePaths: readonly string[],
): WorktreeSessionHint[] {
  return detectCodexWorktreeSessionEntries(
    sessionMeta,
    parseJsonLineEntries(lines),
    resolveMentionedWorktreePathLineMentions(lines, worktreePaths),
    worktreePaths,
  );
}

function detectCodexWorktreeSessionEntries(
  sessionMeta: CodexSessionMetaCwd,
  entries: readonly JsonLineEntry[],
  textMentions: readonly CodexWorktreePathMention[],
  worktreePaths: readonly string[],
): WorktreeSessionHint[] {
  const evidencesByWorktreePath = new Map<string, CodexWorktreeEvidence>();

  const addEvidence = (
    worktreePath: string,
    evidenceRank: number,
    sequence: number,
  ): void => {
    const nextEvidence = { worktreePath, evidenceRank, sequence };
    const existing = evidencesByWorktreePath.get(worktreePath);
    if (existing && compareCodexWorktreeEvidence(nextEvidence, existing) >= 0) {
      return;
    }
    evidencesByWorktreePath.set(worktreePath, nextEvidence);
  };

  const sessionWorktreePath = resolveContainingWorktreePath(sessionMeta.cwd, worktreePaths);
  if (sessionWorktreePath) {
    addEvidence(sessionWorktreePath, CODEX_EVIDENCE_RANK.primary, 0);
  }

  for (const entry of entries) {
    const parsed = parseCodexExecCommandEndCwd(entry.entry);
    if (!parsed) {
      continue;
    }
    const worktreePath = resolveContainingWorktreePath(parsed.cwd, worktreePaths);
    if (worktreePath) {
      addEvidence(worktreePath, CODEX_EVIDENCE_RANK.cwd, entry.lineIndex);
    }
  }

  for (const entry of entries) {
    const parsed = parseCodexFunctionCallWorkdir(entry.entry);
    if (!parsed) {
      continue;
    }
    const worktreePath = resolveContainingWorktreePath(parsed.workdir, worktreePaths);
    if (worktreePath) {
      addEvidence(worktreePath, CODEX_EVIDENCE_RANK.cwd, entry.lineIndex);
    }
  }

  for (const entry of entries) {
    const parsed = parseCodexPatchApplyChanges(entry.entry);
    if (!parsed) {
      continue;
    }
    for (const changedPath of parsed.changedPaths) {
      const worktreePath = resolveContainingWorktreePath(changedPath, worktreePaths);
      if (worktreePath) {
        addEvidence(worktreePath, CODEX_EVIDENCE_RANK.patch, entry.lineIndex);
      }
    }
  }

  for (const mention of textMentions) {
    if (!evidencesByWorktreePath.has(mention.worktreePath)) {
      addEvidence(mention.worktreePath, CODEX_EVIDENCE_RANK.text, mention.sequence);
    }
  }

  return Array.from(evidencesByWorktreePath.values())
    .sort(compareCodexWorktreeEvidence)
    .map(
      (evidence, worktreeRank) =>
        ({
          provider: "codex",
          providerSessionId: sessionMeta.providerSessionId,
          worktreePath: evidence.worktreePath,
          worktreeRank,
        }) satisfies WorktreeSessionHint,
    );
}

function compareCodexWorktreeEvidence(
  a: CodexWorktreeEvidence,
  b: CodexWorktreeEvidence,
): number {
  const evidenceOrder = a.evidenceRank - b.evidenceRank;
  if (evidenceOrder !== 0) {
    return evidenceOrder;
  }
  const recencyOrder = b.sequence - a.sequence;
  if (recencyOrder !== 0) {
    return recencyOrder;
  }
  return a.worktreePath.localeCompare(b.worktreePath);
}

function resolveMentionedWorktreePathMentions(
  content: string,
  worktreePaths: readonly string[],
): CodexWorktreePathMention[] {
  return worktreePaths
    .map((worktreePath) => ({
      original: worktreePath,
      resolved: path.resolve(worktreePath),
    }))
    .sort((a, b) => b.resolved.length - a.resolved.length)
    .flatMap((worktree) => {
      const index = findLastPathMentionIndex(content, worktree.resolved);
      return index === null ? [] : [{ worktreePath: worktree.original, sequence: index }];
    });
}

function resolveMentionedWorktreePathLineMentions(
  lines: readonly CodexSessionLine[],
  worktreePaths: readonly string[],
): CodexWorktreePathMention[] {
  return worktreePaths
    .map((worktreePath) => ({
      original: worktreePath,
      resolved: path.resolve(worktreePath),
    }))
    .sort((a, b) => b.resolved.length - a.resolved.length)
    .flatMap((worktree) => {
      const mention = findLastPathLineMention(lines, worktree.resolved);
      return mention === null ? [] : [{ worktreePath: worktree.original, sequence: mention }];
    });
}

function findLastPathLineMention(
  lines: readonly CodexSessionLine[],
  resolvedPath: string,
): number | null {
  let lastLineIndex: number | null = null;
  for (const line of lines) {
    if (findLastPathMentionIndex(line.text, resolvedPath) !== null) {
      lastLineIndex = line.lineIndex;
    }
  }
  return lastLineIndex;
}

function findLastPathMentionIndex(content: string, resolvedPath: string): number | null {
  let lastIndex: number | null = null;
  let index = content.indexOf(resolvedPath);
  while (index !== -1) {
    const before = content[index - 1];
    const after = content[index + resolvedPath.length];
    if (isPathMentionStartBoundary(before) && isPathMentionEndBoundary(after)) {
      lastIndex = index;
    }
    index = content.indexOf(resolvedPath, index + 1);
  }
  return lastIndex;
}

function isPathMentionStartBoundary(char: string | undefined): boolean {
  return char === undefined || !isPathSegmentChar(char);
}

function isPathMentionEndBoundary(char: string | undefined): boolean {
  return char === undefined || char === path.sep || !isPathSegmentChar(char);
}

function isPathSegmentChar(char: string): boolean {
  return /[A-Za-z0-9._-]/.test(char);
}
