import {
  normalizeRealPath,
  resolveContainingWorktreePath,
  resolveMentionedWorktreePaths,
  type WorktreeSessionHint,
} from "../session-detection.js";

export const DEVIN_EVIDENCE_RANK = {
  workDir: 0,
  mention: 1,
} as const;

// Sessions launched with the worktree as cwd (outside Yuru) record that
// worktree as working_directory. This is the strongest evidence.
// `worktrees` maps each realpath-normalized worktree path to its original.
export function detectDevinWorkDirHint(
  agentSessionId: string,
  workDir: string,
  worktrees: ReadonlyMap<string, string>,
): WorktreeSessionHint | null {
  const matched = resolveContainingWorktreePath(normalizeRealPath(workDir), [...worktrees.keys()]);
  const worktreePath = matched === null ? undefined : worktrees.get(matched);
  if (worktreePath === undefined) {
    return null;
  }
  return {
    provider: "devin",
    agentSessionId,
    worktreePath,
    worktreeRank: DEVIN_EVIDENCE_RANK.workDir,
  };
}

// Yuru-launched sessions run at the repo root, so their worktree association
// comes from the recorded conversation: the injected worktree context prompt
// mentions the worktree path in the first user message. `contents` is expected
// to already be filtered to messages containing the injection marker — a bare
// path mention in ordinary conversation is not evidence that the session
// belongs to that worktree.
export function detectDevinMentionHints(
  agentSessionId: string,
  contents: readonly string[],
  worktreePaths: readonly string[],
): WorktreeSessionHint[] {
  const mentioned = new Set<string>();
  for (const content of contents) {
    for (const worktreePath of resolveMentionedWorktreePaths(content, worktreePaths)) {
      mentioned.add(worktreePath);
    }
  }
  return Array.from(mentioned, (worktreePath) => ({
    provider: "devin",
    agentSessionId,
    worktreePath,
    worktreeRank: DEVIN_EVIDENCE_RANK.mention,
  }));
}
