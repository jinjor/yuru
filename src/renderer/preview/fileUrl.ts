import type { PreviewSide } from "../../shared/ipc";

export function previewFileUrl({ absolutePath, contentId }: PreviewSide): string {
  const path = /^[a-z]:[\\/]|^\\\\/i.test(absolutePath)
    ? absolutePath.replaceAll("\\", "/")
    : absolutePath;
  const encoded = encodeURI(path).replaceAll("#", "%23").replaceAll("?", "%3F");
  // Chromium のキャッシュに古い内容が残らないよう、版を URL に含める。
  return `${new URL(`file:${encoded}`).href}?v=${encodeURIComponent(contentId)}`;
}
