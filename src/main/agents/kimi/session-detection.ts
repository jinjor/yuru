import fs from "fs";
import path from "path";
import { WORKTREE_CONTEXT_PROMPT_MARKER } from "../../sessions/context-prompt.js";
import {
  resolveContainingWorktreePath,
  resolveMentionedWorktreePaths,
  type WorktreeSessionHint,
} from "../../sessions/detection.js";

export interface KimiStoredSessionRef {
  agentSessionId: string;
  sessionDir: string;
  workDir: string;
}

export const KIMI_EVIDENCE_RANK = {
  workDir: 0,
  mention: 1,
} as const;

// kimi realpath-resolves workDir before recording it (e.g. /tmp becomes
// /private/tmp on macOS) while Yuru's worktree paths are not necessarily
// resolved, so the workDir comparison needs both sides normalized.
export function normalizeRealPath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

// Sessions launched with the worktree as cwd (outside Yuru) record that
// worktree as workDir. This is the strongest evidence.
export function detectKimiWorkDirHint(
  ref: KimiStoredSessionRef,
  worktreePaths: readonly string[],
): WorktreeSessionHint | null {
  const normalizedWorktreePaths = worktreePaths.map(normalizeRealPath);
  const matched = resolveContainingWorktreePath(
    normalizeRealPath(ref.workDir),
    normalizedWorktreePaths,
  );
  if (!matched) {
    return null;
  }
  return {
    provider: "kimi",
    agentSessionId: ref.agentSessionId,
    worktreePath: worktreePaths[normalizedWorktreePaths.indexOf(matched)],
    worktreeRank: KIMI_EVIDENCE_RANK.workDir,
  };
}

// Yuru-launched sessions run at the repo root, so their worktree association
// comes from the wire log: the injected worktree context prompt mentions the
// worktree path in the first user message. Only lines containing the
// injection marker count — a bare path mention in ordinary conversation is
// not evidence that the session belongs to that worktree.
export function detectKimiMentionHints(
  ref: KimiStoredSessionRef,
  lines: readonly string[],
  worktreePaths: readonly string[],
): WorktreeSessionHint[] {
  const mentioned = new Set<string>();
  for (const line of lines) {
    if (!line.includes(WORKTREE_CONTEXT_PROMPT_MARKER)) {
      continue;
    }
    for (const worktreePath of resolveMentionedWorktreePaths(line, worktreePaths)) {
      mentioned.add(worktreePath);
    }
  }
  return Array.from(mentioned, (worktreePath) => ({
    provider: "kimi",
    agentSessionId: ref.agentSessionId,
    worktreePath,
    worktreeRank: KIMI_EVIDENCE_RANK.mention,
  }));
}
