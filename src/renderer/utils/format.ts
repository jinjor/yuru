// プレビューのメタ情報に出すファイルサイズ。
export function formatBytes(byteLength: number): string {
  if (byteLength < 1024) {
    return `${byteLength} B`;
  }
  if (byteLength < 1024 * 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`;
  }
  return `${(byteLength / 1024 / 1024).toFixed(1)} MB`;
}

// 音声・動画の長さ。1 時間以上は h:mm:ss、それ未満は m:ss。
export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const paddedSeconds = String(total % 60).padStart(2, "0");
  if (minutes < 60) {
    return `${minutes}:${paddedSeconds}`;
  }
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${paddedSeconds}`;
}
