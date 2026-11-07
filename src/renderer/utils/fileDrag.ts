export const PASTE_PATH_DRAG_TYPE = "application/x-yuru-paste-path";

// path はターミナルへドロップしたときに貼るパス。worktree 内は相対パス、外は絶対パス。
export function beginPastePathDrag(
  dataTransfer: DataTransfer,
  source: HTMLElement,
  path: string,
): void {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(PASTE_PATH_DRAG_TYPE, path);
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

export function endPastePathDrag(source: HTMLElement): void {
  source.classList.remove("file-transfer-dragging");
  document.body.classList.remove("is-file-transfer-dragging");
}

export function hasPastePathDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(PASTE_PATH_DRAG_TYPE);
}

export function readPastePathDrag(dataTransfer: DataTransfer): string {
  return dataTransfer.getData(PASTE_PATH_DRAG_TYPE);
}
