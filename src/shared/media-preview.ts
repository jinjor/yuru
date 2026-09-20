// <audio> / <video> で再生する拡張子。
// 形式の判定は Chromium が拡張子から行うので、ここに載っていても再生できないことはある
// (その場合は要素の error で気づく)。
const audioExtensions = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
  ".weba",
]);

// .mov は QuickTime のコンテナで、Chromium が再生できるとは限らない。
// 音声・動画として扱って「再生できない」と出す方が、バイナリ扱いで何も出ないより分かりやすい。
const videoExtensions = new Set([".m4v", ".mov", ".mp4", ".ogv", ".webm"]);

export type MediaPreviewKind = "audio" | "video";

// 拡張子から音声・動画の種類を返す。どちらでもない path は null。
export function mediaPreviewKind(filePath: string): MediaPreviewKind | null {
  const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dotIndex = fileName.lastIndexOf(".");
  // 先頭の "." は拡張子ではなく dotfile なので除く (".mp3" というファイル名は音声扱いしない)。
  if (dotIndex <= 0) {
    return null;
  }
  const extension = fileName.slice(dotIndex).toLowerCase();

  if (audioExtensions.has(extension)) {
    return "audio";
  }
  return videoExtensions.has(extension) ? "video" : null;
}
