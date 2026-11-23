import {
  normalizeRealPath,
  resolveContainingWorktreePath,
  resolveMentionedWorktreePaths,
  type WorktreeSessionHint,
} from "../session-detection.js";

const ANTIGRAVITY_EVIDENCE_RANK = {
  workDir: 0,
  mention: 1,
} as const;

// Sessions launched with the worktree as cwd (outside Yuru) record that
// worktree in workspace_uris. This is the strongest evidence.
// `worktrees` maps each realpath-normalized worktree path to its original.
export function detectAntigravityWorkDirHint(
  agentSessionId: string,
  workspaceDirs: readonly string[],
  worktrees: ReadonlyMap<string, string>,
): WorktreeSessionHint | null {
  const normalizedWorktreeKeys = [...worktrees.keys()];
  for (const workspaceDir of workspaceDirs) {
    const matched = resolveContainingWorktreePath(
      normalizeRealPath(workspaceDir),
      normalizedWorktreeKeys,
    );
    const worktreePath = matched === null ? undefined : worktrees.get(matched);
    if (worktreePath !== undefined) {
      return {
        provider: "antigravity",
        agentSessionId,
        worktreePath,
        worktreeRank: ANTIGRAVITY_EVIDENCE_RANK.workDir,
      };
    }
  }
  return null;
}

// Yuru-launched sessions run at the repo root, so their worktree association
// comes from the recorded transcript: the injected worktree context prompt
// appears in a USER_INPUT entry. `lines` is expected to already be filtered to
// lines containing the injection marker.
export function detectAntigravityMentionHints(
  agentSessionId: string,
  lines: readonly string[],
  worktreePaths: readonly string[],
): WorktreeSessionHint[] {
  const mentioned = new Set<string>();
  for (const line of lines) {
    const content = extractUserInputContent(line);
    if (content === null) {
      continue;
    }
    for (const worktreePath of resolveMentionedWorktreePaths(content, worktreePaths)) {
      mentioned.add(worktreePath);
    }
  }
  return Array.from(mentioned, (worktreePath) => ({
    provider: "antigravity",
    agentSessionId,
    worktreePath,
    worktreeRank: ANTIGRAVITY_EVIDENCE_RANK.mention,
  }));
}

export function extractUserInputContent(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const entry = parsed as { type?: unknown; content?: unknown };
  return entry.type === "USER_INPUT" && typeof entry.content === "string" ? entry.content : null;
}
