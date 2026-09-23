import { WORKTREE_CONTEXT_PROMPT_MARKER } from "../worktree-context-prompt.js";
import {
  normalizeRealPath,
  normalizeWorktreePaths,
  resolveContainingWorktreePath,
  resolveMentionedWorktreePaths,
  type WorktreeSessionHint,
} from "../session-detection.js";

export { normalizeRealPath, normalizeWorktreePaths };

export interface KimiStoredSessionRef {
  agentSessionId: string;
  sessionDir: string;
  workDir: string;
}

export const KIMI_EVIDENCE_RANK = {
  workDir: 0,
  mention: 1,
} as const;

// Sessions launched with the worktree as cwd (outside Yuru) record that
// worktree as workDir. This is the strongest evidence.
// `worktrees` maps each realpath-normalized worktree path to its original.
export function detectKimiWorkDirHint(
  ref: KimiStoredSessionRef,
  worktrees: ReadonlyMap<string, string>,
): WorktreeSessionHint | null {
  const matched = resolveContainingWorktreePath(normalizeRealPath(ref.workDir), [
    ...worktrees.keys(),
  ]);
  const worktreePath = matched === null ? undefined : worktrees.get(matched);
  if (worktreePath === undefined) {
    return null;
  }
  return {
    provider: "kimi",
    agentSessionId: ref.agentSessionId,
    worktreePath,
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
