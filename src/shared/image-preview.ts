// <img> にそのまま渡せる画像形式。
const imageExtensions = new Set([
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

// 拡張子から画像かどうかを返す。画像として描画できない path は false。
export function isImagePath(filePath: string): boolean {
  const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dotIndex = fileName.lastIndexOf(".");
  // 先頭の "." は拡張子ではなく dotfile なので除く (".png" というファイル名は画像扱いしない)。
  if (dotIndex <= 0) {
    return false;
  }
  return imageExtensions.has(fileName.slice(dotIndex).toLowerCase());
}
