import path from "path";

const CLAUDE_WORKTREE_SEGMENT = ".claude/worktrees";
const YURU_WORKTREE_SEGMENT = ".yuru/worktrees";

export function yuruWorktreeCwd(repoPath: string, worktreeName: string): string {
  return path.join(repoPath, YURU_WORKTREE_SEGMENT, worktreeName);
}

export function repoPathFromCwd(cwd: string): string {
  for (const segment of [CLAUDE_WORKTREE_SEGMENT, YURU_WORKTREE_SEGMENT]) {
    const marker = `/${segment}/`;
    const idx = cwd.indexOf(marker);
    if (idx !== -1) {
      return cwd.substring(0, idx);
    }
  }
  return cwd;
}
