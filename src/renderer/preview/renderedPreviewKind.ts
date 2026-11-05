import { isImagePath } from "../../shared/image-preview";
import { mediaPreviewKind } from "../../shared/media-preview";
import { isPdfPath } from "../../shared/pdf-preview";

const markdownExtensions = new Set(["md", "markdown"]);
const htmlExtensions = new Set(["htm", "html"]);

type RenderedPreviewKind = "html" | "image" | "markdown" | "media" | "pdf";

export function renderedPreviewKind(path: string): RenderedPreviewKind | null {
  if (isPdfPath(path)) {
    return "pdf";
  }
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) {
    return null;
  }
  if (markdownExtensions.has(ext)) {
    return "markdown";
  }
  if (htmlExtensions.has(ext)) {
    return "html";
  }
  // SVG は画像として描画できるテキストなので、閲覧モードではそのまま差分も読める。
  if (isImagePath(path)) {
    return "image";
  }
  if (mediaPreviewKind(path) !== null) {
    return "media";
  }
  return null;
}
