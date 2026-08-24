export const WORKTREE_FILE_DRAG_TYPE = "application/x-yuru-worktree-file-path";

export function beginWorktreeFileDrag(
  dataTransfer: DataTransfer,
  source: HTMLElement,
  relativePath: string,
): void {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(WORKTREE_FILE_DRAG_TYPE, relativePath);
  source.classList.add("file-transfer-dragging");
  document.body.classList.add("is-file-transfer-dragging");
}

export function endWorktreeFileDrag(source: HTMLElement): void {
  source.classList.remove("file-transfer-dragging");
  document.body.classList.remove("is-file-transfer-dragging");
}

export function hasWorktreeFileDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(WORKTREE_FILE_DRAG_TYPE);
}

export function readWorktreeFileDrag(dataTransfer: DataTransfer): string {
  return dataTransfer.getData(WORKTREE_FILE_DRAG_TYPE);
}
