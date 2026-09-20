import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import type { GitDiffScope, PreviewDiffDocument, PreviewSide } from "../../shared/ipc.js";
import { execToFile } from "../exec.js";
import { statRegularFile } from "../files/files.js";
import { resolveDiffSources, statDiffSource, type DiffSource } from "../git/diff.js";
import { resolveGitReviewBase } from "../git/repo.js";

// git の中にしかない側 (HEAD / index の blob) を表示できるようにするため、取り出した中身を置く場所。
// blob OID は不変なので、OID をそのままファイル名にして使い回す。古いものが残っていても
// 中身は常にその OID のものなので、自分では消さない (temp の掃除は OS に任せる)。
const blobCacheDirectory = path.join(os.tmpdir(), "yuru-blob-cache");

/**
 * 画像・音声・動画のように、中身を文字列にできないファイルのプレビュー用。
 * 中身は要素 (<img> / <audio> / <video>) が URL から直接読むので、ここが返すのは
 * 大きさと URL だけで、中身がアプリのメモリを通ることはない。
 * 差分の範囲 (scope) の解釈は git 側に任せる。
 */
export async function getPreviewDiffDocument(
  cwd: string,
  filePath: string,
  scope?: GitDiffScope,
): Promise<PreviewDiffDocument> {
  const reviewBase = scope ? await resolveGitReviewBase(cwd) : null;
  const { original, current } = await resolveDiffSources(cwd, filePath, scope, reviewBase);
  const [originalSide, currentSide] = await Promise.all([
    toPreviewSide(cwd, original),
    toPreviewSide(cwd, current),
  ]);
  return { path: filePath, original: originalSide, current: currentSide };
}

// worktree 外のファイル (ターミナルリンク由来の絶対パス)。git は関わらないので差分なしで返す。
export async function getPreviewFileDocument(
  absolutePath: string,
): Promise<PreviewDiffDocument | null> {
  const stat = await statRegularFile(absolutePath);
  if (stat === null) {
    return null;
  }
  // git が index で使っているのと同じ stat ベースの判定。
  const side = {
    byteLength: stat.size,
    url: fileUrl(absolutePath, `${stat.size}:${stat.mtimeMs}`),
  };
  return { path: absolutePath, original: side, current: side };
}

async function toPreviewSide(cwd: string, source: DiffSource | null): Promise<PreviewSide | null> {
  const stat = await statDiffSource(cwd, source);
  if (source === null || stat === null) {
    return null;
  }
  const absolutePath =
    source.kind === "worktree"
      ? path.join(cwd, source.path)
      : await cacheGitBlob(cwd, stat.contentId, source.path);
  return { byteLength: stat.byteLength, url: fileUrl(absolutePath, stat.contentId) };
}

async function cacheGitBlob(cwd: string, oid: string, filePath: string): Promise<string> {
  // 拡張子は、Chromium が形式を判断する手がかりなので残す。
  const cachePath = path.join(blobCacheDirectory, `${oid}${path.extname(filePath).toLowerCase()}`);
  if ((await statRegularFile(cachePath)) !== null) {
    return cachePath;
  }

  await fs.promises.mkdir(blobCacheDirectory, { recursive: true });
  // 書き終える前のファイルを表示に使わせないため、別名で書いてから rename する。
  const pendingPath = `${cachePath}.${randomUUID()}`;
  try {
    await execToFile("git", ["cat-file", "blob", oid], cwd, pendingPath);
    await fs.promises.rename(pendingPath, cachePath);
  } catch (error) {
    await fs.promises.rm(pendingPath, { force: true });
    throw error;
  }
  return cachePath;
}

/**
 * URL がそのまま「どの中身か」を表すようにする。Chromium は URL 全体でキャッシュするので、
 * 作業ツリーのファイルのようにパスが変わらないものは、中身が変わったことを URL に出さないと
 * 古い内容が表示され続ける。クエリはファイルの場所には影響しない。
 */
function fileUrl(absolutePath: string, contentId: string): string {
  return `${pathToFileURL(absolutePath).href}?v=${encodeURIComponent(contentId)}`;
}
