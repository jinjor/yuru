import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { toAppError } from "../errors/app-error.js";
import { recordAppWarning } from "../errors/center.js";
import { getYuruHome } from "../yuru-home.js";

// 貼り付けた画像の実体を置く場所。bookmarks.json と同じ ~/.yuru の下。
function imagesDirectory(): string {
  return path.join(getYuruHome(), "bookmark-images");
}

// 保存できる形式と、ファイル名に付ける拡張子、拒否したときにユーザーへ見せる名前。
// プレビューは拡張子で画像かどうかを判定するので、media type から必ず対応する拡張子を付ける。
const formats = new Map([
  ["image/png", { extension: ".png", label: "PNG" }],
  ["image/jpeg", { extension: ".jpg", label: "JPEG" }],
  ["image/gif", { extension: ".gif", label: "GIF" }],
  ["image/webp", { extension: ".webp", label: "WebP" }],
]);

// saveBookmarkImage が null を返したときに出す文言。
export const unsupportedImageMessage = `Only ${[...formats.values()]
  .map((format) => format.label)
  .join(", ")} images can be bookmarked.`;

// data URL (RFC 2397) のうち、FileReader.readAsDataURL が作る base64 形式だけを受ける。
const dataUrlPattern = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

// 対応形式の画像ならファイルに保存し、その file:// URL を返す。対応外の形式は null。
export function saveBookmarkImage(dataUrl: string): string | null {
  const match = dataUrlPattern.exec(dataUrl);
  const format = match ? formats.get(match[1].toLowerCase()) : undefined;
  if (!match || !format) {
    return null;
  }
  const directory = imagesDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${crypto.randomUUID()}${format.extension}`);
  fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
  return pathToFileURL(filePath).href;
}

// 画像ブックマークの url から実体のパスを取る。bookmarks.json は手で編集できるので、
// 保存場所の外を指していたら扱わない。
export function bookmarkImagePath(url: string): string | null {
  if (!URL.canParse(url)) {
    return null;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "file:") {
    return null;
  }
  const filePath = fileURLToPath(parsed);
  return path.dirname(filePath) === imagesDirectory() ? filePath : null;
}

// ブックマークを消すときに実体も消す。消せなくてもブックマークの削除自体は成立させる。
export function deleteBookmarkImage(url: string): void {
  const filePath = bookmarkImagePath(url);
  if (!filePath) {
    return;
  }
  try {
    fs.rmSync(filePath, { force: true });
  } catch (error) {
    recordAppWarning(toAppError(error));
  }
}
