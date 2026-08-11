import fs from "fs";
import path from "path";
import type { FileTreeNode } from "../../shared/ipc.js";
import { execBuffer } from "../exec.js";
import { isFileNotFoundError } from "../errors/app-error.js";

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function resolveSessionPath(workingRoot: string, relativePath = ""): string {
  const basePath = path.resolve(workingRoot);
  const targetPath = relativePath ? path.resolve(basePath, relativePath) : basePath;
  const relative = path.relative(basePath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid path");
  }
  return targetPath;
}

async function detectDirectory(entryPath: string, dirent: fs.Dirent): Promise<boolean> {
  if (dirent.isDirectory()) {
    return true;
  }
  if (!dirent.isSymbolicLink()) {
    return false;
  }
  try {
    const stats = await fs.promises.stat(entryPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

// ターミナルのファイルリンクからの解決。worktree 内なら相対パス、外なら絶対パスを返す。
// 絶対パスは実在する通常ファイルのみ許し、不在・ディレクトリ・相対パスでの外への脱出は null。
export function resolveRepoFile(
  workingRoot: string,
  filePath: string,
  repoRoot = workingRoot,
): string | null {
  const basePath = path.resolve(workingRoot);
  const isAbsoluteInput = path.isAbsolute(filePath);
  const candidates = isAbsoluteInput
    ? [path.resolve(filePath)]
    : [path.resolve(basePath, filePath), path.resolve(repoRoot, filePath)];

  for (const candidate of candidates) {
    const relative = path.relative(basePath, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      if (!isAbsoluteInput) {
        continue;
      }
      try {
        return fs.statSync(candidate).isFile() ? candidate : null;
      } catch {
        return null;
      }
    }
    try {
      if (fs.statSync(candidate).isFile()) {
        return normalizeRelativePath(relative);
      }
    } catch {
      // 相対パスは worktree 基準を優先し、不在なら repo root 基準も試す。
    }
  }
  return null;
}

// HTML プレビュー対象の解決。worktree 内なら root=worktree ルート、外なら root=entry の
// 親ディレクトリ (相対参照される CSS / JavaScript は大抵同じディレクトリにある)。
export function resolveHtmlPreviewEntry(
  workingRoot: string,
  filePath: string,
): { root: string; path: string } | null {
  const resolvedPath = resolveRepoFile(workingRoot, filePath);
  if (!resolvedPath) {
    return null;
  }
  if (path.isAbsolute(resolvedPath)) {
    return { root: path.dirname(resolvedPath), path: path.basename(resolvedPath) };
  }
  return { root: workingRoot, path: resolvedPath };
}

// 絶対パス指定の読み取り。不在・通常ファイルでない場合は null (呼び出し側で範囲を確認済みの前提)。
export async function readRegularFile(absolutePath: string): Promise<Buffer | null> {
  try {
    const stat = await fs.promises.stat(absolutePath);
    if (!stat.isFile()) {
      return null;
    }
    return await fs.promises.readFile(absolutePath);
  } catch (error) {
    // ENOTDIR はパス途中のコンポーネントがファイルだった場合。どちらも「開けない」ので null。
    if (isFileNotFoundError(error) || (error as { code?: unknown }).code === "ENOTDIR") {
      return null;
    }
    throw error;
  }
}

// 編集モードの seed 用。既存テキストは内容 (空は "")、不在は null、範囲外は throw。
export async function readWorktreeFile(
  workingRoot: string,
  filePath: string,
): Promise<string | null> {
  const targetPath = resolveSessionPath(workingRoot, filePath);
  try {
    return await fs.promises.readFile(targetPath, "utf-8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

// 既存ファイルの更新のみ。"r+" は O_CREAT を付けないので、対象が無ければ ENOENT で失敗する
// (編集中に削除されたファイルを autosave / 離脱時 flush で復活させない。TOCTOU も避けられる)。
export async function writeFile(
  workingRoot: string,
  filePath: string,
  content: string,
): Promise<void> {
  const targetPath = resolveSessionPath(workingRoot, filePath);
  const handle = await fs.promises.open(targetPath, "r+");
  try {
    const { bytesWritten } = await handle.write(content, 0, "utf-8");
    await handle.truncate(bytesWritten);
  } finally {
    await handle.close();
  }
}

export async function listAllFiles(workingRoot: string): Promise<string[]> {
  const [trackedBuffer, untrackedBuffer] = await Promise.all([
    execBuffer("git", ["ls-files", "-z", "--cached", "--stage"], workingRoot),
    execBuffer("git", ["ls-files", "-z", "--others", "--exclude-standard"], workingRoot),
  ]);
  const tracked = parseStagedRecords(trackedBuffer.toString("utf-8"));
  const untracked = splitNulSeparated(untrackedBuffer.toString("utf-8"));
  return [...tracked, ...untracked];
}

function parseStagedRecords(text: string): string[] {
  const paths: string[] = [];
  for (const record of splitNulSeparated(text)) {
    const tabIndex = record.indexOf("\t");
    if (tabIndex < 0) {
      continue;
    }
    const mode = record.slice(0, record.indexOf(" "));
    if (mode === "160000") {
      continue;
    }
    paths.push(record.slice(tabIndex + 1));
  }
  return paths;
}

function splitNulSeparated(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const parts = text.split("\0");
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

export async function listFiles(workingRoot: string, relativePath = ""): Promise<FileTreeNode[]> {
  const targetPath = resolveSessionPath(workingRoot, relativePath);
  const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });

  const nodes = await Promise.all(
    entries
      .filter((entry) => entry.name !== ".git")
      .map(async (entry) => {
        const entryPath = path.join(targetPath, entry.name);
        const entryRelativePath = normalizeRelativePath(path.relative(workingRoot, entryPath));
        const isDirectory = await detectDirectory(entryPath, entry);
        return {
          id: entryRelativePath,
          path: entryRelativePath,
          name: entry.name,
          kind: isDirectory ? "directory" : "file",
          children: isDirectory ? [] : null,
        } satisfies FileTreeNode;
      }),
  );

  nodes.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return nodes;
}
