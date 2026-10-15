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

// Finder などアプリの外へドロップしたとき、Chromium がこのファイルをドロップ先へダウンロードする
// (結果としてコピーになる)。値は `MIME type:ファイル名:URL` で、区切りの `:` をエスケープする
// 手段がないため、名前に `:` を含むファイルは外へ出さない。
export function setFileDownloadDrag(
  dataTransfer: DataTransfer,
  absolutePath: string,
  fileName: string,
): void {
  if (fileName.includes(":")) {
    return;
  }
  dataTransfer.setData(
    "DownloadURL",
    `application/octet-stream:${fileName}:${fileUrl(absolutePath)}`,
  );
}

function fileUrl(absolutePath: string): string {
  return `file://${absolutePath.split("/").map(encodeURIComponent).join("/")}`;
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
