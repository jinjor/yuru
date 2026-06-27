import type { WorktreeListItem } from "../../shared/metadata";

export function worktreeLabelText(worktree: Pick<WorktreeListItem, "branch" | "headSha">): string {
  if (!worktree.headSha) {
    return "(no commits)";
  }
  if (worktree.branch) {
    return worktree.branch;
  }
  return `detached @ ${worktree.headSha.slice(0, 7)}`;
}
