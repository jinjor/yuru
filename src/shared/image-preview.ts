// <img> にそのまま渡せる画像形式と、data URL に付ける media type の対応。
const imageMediaTypes = new Map<string, string>([
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

// 拡張子から画像の media type を返す。画像として描画できない path は null。
export function imageMediaType(filePath: string): string | null {
  const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dotIndex = fileName.lastIndexOf(".");
  // 先頭の "." は拡張子ではなく dotfile なので除く (".png" というファイル名は画像扱いしない)。
  if (dotIndex <= 0) {
    return null;
  }
  return imageMediaTypes.get(fileName.slice(dotIndex).toLowerCase()) ?? null;
}
