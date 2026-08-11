import fs from "fs";
import path from "path";
import type { GitDiffDocument, GitDiffScope, GitLineStat } from "../../shared/ipc.js";
import { exec, execBuffer } from "../exec.js";
import { readRegularFile } from "../files/files.js";
import { resolveGitReviewBase, type GitReviewBase } from "./repo.js";

export interface NameStatusEntry {
  status: string;
  path: string;
  srcPath?: string;
}

export interface RawDiffEntry {
  status: string;
  path: string;
  srcPath?: string;
  srcOid: string;
  dstOid: string;
}

// `git diff --raw -z --no-abbrev` を、変更先 path と両側の blob OID に分解する。
// header と path はそれぞれ NUL 区切りで、rename/copy だけ path が 2 個続く。
export function parseRawDiffZ(output: string): RawDiffEntry[] {
  const entries: RawDiffEntry[] = [];
  const tokens = output.split("\0");

  for (let i = 0; i < tokens.length; i++) {
    const header = tokens[i];
    if (!header) {
      continue;
    }
    if (!header.startsWith(":")) {
      throw new Error(`Unexpected raw diff header: ${JSON.stringify(header)}`);
    }
    const fields = header.slice(1).split(" ");
    if (fields.length !== 5) {
      throw new Error(`Unexpected raw diff header: ${JSON.stringify(header)}`);
    }
    const [, , srcOid, dstOid, status] = fields as [string, string, string, string, string];

    if (status.startsWith("R") || status.startsWith("C")) {
      const srcPath = tokens[i + 1];
      const dstPath = tokens[i + 2];
      if (srcPath === undefined || dstPath === undefined) {
        throw new Error("Unexpected raw diff rename record: missing paths");
      }
      entries.push({ status, path: dstPath, srcPath, srcOid, dstOid });
      i += 2;
      continue;
    }

    const filePath = tokens[i + 1];
    if (filePath === undefined) {
      throw new Error("Unexpected raw diff record: missing path");
    }
    entries.push({ status, path: filePath, srcOid, dstOid });
    i += 1;
  }

  return entries;
}

// `git diff --name-status -z` の出力を解釈する。
// 全 field が NUL 区切りで `<status>\0<path>\0` と並び、
// rename/copy では `<R|C><score>\0<src>\0<dst>\0` になる。
export function parseNameStatusZ(output: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  const tokens = output.split("\0");

  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i];
    if (status === "") {
      continue;
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const src = tokens[i + 1];
      const dst = tokens[i + 2];
      if (src === undefined || dst === undefined) {
        throw new Error("Unexpected name-status rename record: missing paths");
      }
      entries.push({ status, path: dst, srcPath: src });
      i += 2;
      continue;
    }

    const path = tokens[i + 1];
    if (path === undefined) {
      throw new Error(`Unexpected name-status record: ${JSON.stringify(status)}`);
    }
    entries.push({ status, path });
    i += 1;
  }

  return entries;
}

// `git diff --numstat -z` の出力を path -> 行数 の Map にする。
// レコードは `<added>\t<deleted>\t<path>\0`、rename/copy では path 部分が空になり
// 続けて `<src>\0<dst>\0` が並ぶ (git-diff の "Other diff formats" 参照)。
// binary file は added/deleted が `-` になるため、行数なしとして Map に含めない。
export function parseNumstatZ(output: string): Map<string, GitLineStat> {
  const stats = new Map<string, GitLineStat>();
  const tokens = output.split("\0");

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "") {
      continue;
    }

    const firstTab = token.indexOf("\t");
    const secondTab = token.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      throw new Error(`Unexpected numstat record: ${JSON.stringify(token)}`);
    }

    const addedField = token.substring(0, firstTab);
    const deletedField = token.substring(firstTab + 1, secondTab);
    let path = token.substring(secondTab + 1);

    if (path === "") {
      // rename/copy: 続く 2 token が src と dst
      const dst = tokens[i + 2];
      if (dst === undefined) {
        throw new Error("Unexpected numstat rename record: missing paths");
      }
      path = dst;
      i += 2;
    }

    if (addedField === "-" || deletedField === "-") {
      continue;
    }

    stats.set(path, {
      added: Number.parseInt(addedField, 10),
      deleted: Number.parseInt(deletedField, 10),
    });
  }

  return stats;
}

async function hasHead(cwd: string): Promise<boolean> {
  try {
    await exec("git", ["rev-parse", "--verify", "HEAD"], cwd);
    return true;
  } catch {
    return false;
  }
}

async function resolveOriginalPath(
  cwd: string,
  filePath: string,
  rangeArgs: readonly string[],
): Promise<string | null> {
  if (!(await hasHead(cwd))) {
    return null;
  }

  // pathspec で対象 file に絞ると rename 元が diff から外れて rename 検出が
  // 効かなくなるため、全体の name-status から対象 file の record を探す
  const output = await exec(
    "git",
    ["diff", "--name-status", "--find-renames", "-z", ...rangeArgs],
    cwd,
  );

  for (const entry of parseNameStatusZ(output)) {
    if (entry.path === filePath) {
      return entry.srcPath ?? filePath;
    }
  }

  return filePath;
}

async function readGitBlobAt(cwd: string, ref: string, filePath: string): Promise<Buffer | null> {
  try {
    return await execBuffer("git", ["show", `${ref}:${filePath}`], cwd);
  } catch {
    return null;
  }
}

async function readIndexBlob(cwd: string, filePath: string): Promise<Buffer | null> {
  try {
    return await execBuffer("git", ["show", `:0:${filePath}`], cwd);
  } catch {
    return null;
  }
}

// 不在 (null) と空ファイル ("") を区別する: 削除は null、空ファイルは ""。
// バイナリの存在する側は "" にする (バイト列を文字列で送らない)。
function bufferToContent(buffer: Buffer | null, isBinary: boolean): string | null {
  if (buffer === null) {
    return null;
  }
  return isBinary ? "" : buffer.toString("utf-8");
}

async function isPathChanged(cwd: string, filePath: string): Promise<boolean> {
  const output = await exec("git", ["status", "--porcelain", "--", filePath], cwd);
  return output.trim().length > 0;
}

// rename 元まで遡って元側の内容を読む。rangeArgs が rename 検出に使う diff の範囲、
// originalRef が元側の blob を読む ref。
async function loadOriginalBuffer(
  cwd: string,
  filePath: string,
  rangeArgs: readonly string[],
  originalRef: string,
): Promise<Buffer | null> {
  const originalPath = await resolveOriginalPath(cwd, filePath, rangeArgs);
  return originalPath ? await readGitBlobAt(cwd, originalRef, originalPath) : null;
}

async function readWorktreeFile(cwd: string, filePath: string): Promise<Buffer | null> {
  const currentPath = path.join(cwd, filePath);
  return fs.existsSync(currentPath) ? await fs.promises.readFile(currentPath) : null;
}

// scope なし: HEAD ↔ 作業ツリー (staged + unstaged の合算)
// base: merge-base ↔ HEAD / staged: HEAD ↔ index / unstaged: index ↔ 作業ツリー
export async function loadDiffBuffers(
  cwd: string,
  filePath: string,
  scope: GitDiffScope | undefined,
  reviewBase: GitReviewBase | null,
): Promise<{ originalBuffer: Buffer | null; currentBuffer: Buffer | null }> {
  if (scope === "base") {
    if (!reviewBase) {
      throw new Error("Base branch is unknown.");
    }
    const [originalBuffer, currentBuffer] = await Promise.all([
      loadOriginalBuffer(cwd, filePath, [reviewBase.mergeBase, "HEAD"], reviewBase.mergeBase),
      readGitBlobAt(cwd, "HEAD", filePath),
    ]);
    return { originalBuffer, currentBuffer };
  }

  if (scope === "staged") {
    const [originalBuffer, currentBuffer] = await Promise.all([
      loadOriginalBuffer(cwd, filePath, ["--cached"], "HEAD"),
      readIndexBlob(cwd, filePath),
    ]);
    return { originalBuffer, currentBuffer };
  }

  if (scope === "unstaged") {
    const [originalBuffer, currentBuffer] = await Promise.all([
      readIndexBlob(cwd, filePath),
      readWorktreeFile(cwd, filePath),
    ]);
    return { originalBuffer, currentBuffer };
  }

  const currentBuffer = await readWorktreeFile(cwd, filePath);
  const originalBuffer = (await isPathChanged(cwd, filePath))
    ? await loadOriginalBuffer(cwd, filePath, ["HEAD"], "HEAD")
    : currentBuffer;
  return { originalBuffer, currentBuffer };
}

export async function getGitDiffDocument(
  cwd: string,
  filePath: string,
  scope?: GitDiffScope,
): Promise<GitDiffDocument> {
  const reviewBase = scope ? await resolveGitReviewBase(cwd) : null;
  const { originalBuffer, currentBuffer } = await loadDiffBuffers(cwd, filePath, scope, reviewBase);
  const isBinary = [originalBuffer, currentBuffer].some((buffer) => buffer?.includes(0));
  const size = Math.max(originalBuffer?.byteLength ?? 0, currentBuffer?.byteLength ?? 0);

  return {
    path: filePath,
    originalContent: bufferToContent(originalBuffer, isBinary),
    currentContent: bufferToContent(currentBuffer, isBinary),
    isBinary,
    size,
  };
}

// worktree 外のファイル用。git は関わらず、差分なし (original = current) のドキュメント
// として返す。不在・通常ファイルでない場合は null。
export async function getFileDocument(absolutePath: string): Promise<GitDiffDocument | null> {
  const buffer = await readRegularFile(absolutePath);
  if (buffer === null) {
    return null;
  }
  const isBinary = buffer.includes(0);
  const content = bufferToContent(buffer, isBinary);
  return {
    path: absolutePath,
    originalContent: content,
    currentContent: content,
    isBinary,
    size: buffer.byteLength,
  };
}
