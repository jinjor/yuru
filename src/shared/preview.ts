export const MAX_PDF_PREVIEW_BYTES = 50 * 1024 * 1024;

export type PreviewKind = "markdown" | "html" | "image" | "audio" | "video" | "pdf";

interface PreviewInfo {
  kind: PreviewKind | null;
  isBinary: boolean;
}

// 拡張子から選ぶ表示方式。実際に表示できるかは各表示先が読み込み時に判断する。
const previewsByExtension: Readonly<Record<string, PreviewInfo>> = {
  md: { kind: "markdown", isBinary: false },
  markdown: { kind: "markdown", isBinary: false },
  htm: { kind: "html", isBinary: false },
  html: { kind: "html", isBinary: false },
  apng: { kind: "image", isBinary: true },
  avif: { kind: "image", isBinary: true },
  bmp: { kind: "image", isBinary: true },
  gif: { kind: "image", isBinary: true },
  ico: { kind: "image", isBinary: true },
  jpeg: { kind: "image", isBinary: true },
  jpg: { kind: "image", isBinary: true },
  png: { kind: "image", isBinary: true },
  svg: { kind: "image", isBinary: false },
  webp: { kind: "image", isBinary: true },
  aac: { kind: "audio", isBinary: true },
  flac: { kind: "audio", isBinary: true },
  m4a: { kind: "audio", isBinary: true },
  mp3: { kind: "audio", isBinary: true },
  oga: { kind: "audio", isBinary: true },
  ogg: { kind: "audio", isBinary: true },
  opus: { kind: "audio", isBinary: true },
  wav: { kind: "audio", isBinary: true },
  weba: { kind: "audio", isBinary: true },
  // .mov は Chromium で再生できるとは限らないが、動画の表示先でエラーを示す。
  m4v: { kind: "video", isBinary: true },
  mov: { kind: "video", isBinary: true },
  mp4: { kind: "video", isBinary: true },
  ogv: { kind: "video", isBinary: true },
  webm: { kind: "video", isBinary: true },
  pdf: { kind: "pdf", isBinary: true },
};

export function getPreviewInfo(filePath: string): PreviewInfo {
  const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dotIndex = fileName.lastIndexOf(".");
  // 拡張子のないファイルと .png のような dotfile はテキストの表示先に渡す。
  const extension = dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
  // 未知の形式はテキスト側で中身を確認する。
  return Object.hasOwn(previewsByExtension, extension)
    ? previewsByExtension[extension]
    : { kind: null, isBinary: false };
}

// テキストとして読み込んだデータの簡易判定。拡張子による表示方式の選択とは別に使う。
export function isBinaryContent(content: Uint8Array): boolean {
  return content.includes(0);
}
