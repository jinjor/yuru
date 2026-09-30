import type { MouseEvent } from "react";

// 右ペインのファイル名の右クリック。相対パスと絶対パスのコピーメニューを出す。
// 絶対パスは選択中 worktree のルートから導く。
export function handleFilePathContextMenu(
  event: MouseEvent<HTMLElement>,
  worktreePath: string,
  relativePath: string,
): void {
  event.preventDefault();
  void window.electronAPI.showFilePathContextMenu(relativePath, `${worktreePath}/${relativePath}`);
}
