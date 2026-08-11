import type { GitDiffScope, ImageDiffDocument, ImageDiffSide } from "../../shared/ipc.js";
import { imageMediaType } from "../../shared/image-preview.js";
import { readRegularFile } from "../files/files.js";
import { loadDiffBuffers } from "../git/diff.js";
import { resolveGitReviewBase } from "../git/repo.js";

// 画像はバイト列なので、テキストの diff document とは別に data URL として送る。
// 差分の範囲 (scope) の解釈はテキストと同じ loadDiffBuffers に任せる。
export async function getImageDiffDocument(
  cwd: string,
  filePath: string,
  scope?: GitDiffScope,
): Promise<ImageDiffDocument | null> {
  const mediaType = imageMediaType(filePath);
  if (mediaType === null) {
    return null;
  }

  const reviewBase = scope ? await resolveGitReviewBase(cwd) : null;
  const { originalBuffer, currentBuffer } = await loadDiffBuffers(cwd, filePath, scope, reviewBase);
  return {
    path: filePath,
    original: toImageSide(originalBuffer, mediaType),
    current: toImageSide(currentBuffer, mediaType),
  };
}

// worktree 外の画像 (ターミナルリンク由来の絶対パス)。git は関わらないので差分なしで返す。
export async function getImageFileDocument(
  absolutePath: string,
): Promise<ImageDiffDocument | null> {
  const mediaType = imageMediaType(absolutePath);
  if (mediaType === null) {
    return null;
  }

  const buffer = await readRegularFile(absolutePath);
  if (buffer === null) {
    return null;
  }
  const side = toImageSide(buffer, mediaType);
  return { path: absolutePath, original: side, current: side };
}

function toImageSide(buffer: Buffer | null, mediaType: string): ImageDiffSide | null {
  if (buffer === null) {
    return null;
  }
  return {
    dataUrl: `data:${mediaType};base64,${buffer.toString("base64")}`,
    byteLength: buffer.byteLength,
  };
}
