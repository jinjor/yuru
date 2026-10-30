import fs from "fs";
import path from "path";
import type { FileTreeNode, RepoPathTarget } from "../../shared/ipc.js";
import { execBuffer } from "../exec.js";
import { isErrnoException } from "../errors/utils.js";

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

// ターミナルのパスのリンクの解決。相対パスは worktree 基準で絶対パスにしてから判定する。
// worktree の中なら実在するファイル・ディレクトリを worktree 基準の相対パス (ルート自身は "") で返す。
// 外はプレビューで開ける通常ファイルだけを絶対パスで返す。それ以外は null。
export async function resolveRepoPath(
  workingRoot: string,
  targetPath: string,
): Promise<RepoPathTarget | null> {
  const basePath = path.resolve(workingRoot);
  const absolutePath = path.resolve(basePath, targetPath);
  const relative = path.relative(basePath, absolutePath);
  const stats = await statExisting(absolutePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return stats?.isFile() ? { kind: "file", path: absolutePath } : null;
  }
  if (stats?.isFile()) {
    return { kind: "file", path: normalizeRelativePath(relative) };
  }
  if (stats?.isDirectory()) {
    return { kind: "directory", path: normalizeRelativePath(relative) };
  }
  return null;
}

// HTML プレビュー対象の解決。worktree 内なら root=worktree ルート、外なら root=entry の
// 親ディレクトリ (相対参照される CSS / JavaScript は大抵同じディレクトリにある)。
export async function resolveHtmlPreviewEntry(
  workingRoot: string,
  filePath: string,
): Promise<{ root: string; path: string } | null> {
  const target = await resolveRepoPath(workingRoot, filePath);
  if (target?.kind !== "file") {
    return null;
  }
  if (path.isAbsolute(target.path)) {
    return { root: path.dirname(target.path), path: path.basename(target.path) };
  }
  return { root: workingRoot, path: target.path };
}

// 絶対パス指定の読み取り。不在・通常ファイルでない場合は null (呼び出し側で範囲を確認済みの前提)。
export async function readRegularFile(absolutePath: string): Promise<Buffer | null> {
  if ((await statRegularFile(absolutePath)) === null) {
    return null;
  }
  return await fs.promises.readFile(absolutePath);
}

// 中身を読まずに大きさと更新時刻だけ見る。不在・通常ファイルでない場合は null。
export async function statRegularFile(absolutePath: string): Promise<fs.Stats | null> {
  const stat = await statExisting(absolutePath);
  return stat?.isFile() ? stat : null;
}

// 不在は null。
async function statExisting(targetPath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(targetPath);
  } catch (error) {
    // ENOTDIR はパス途中のコンポーネントがファイルだった場合。これも不在として扱う。
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
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
    if (isErrnoException(error) && error.code === "ENOENT") {
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
