import fs from "fs";
import path from "path";
import type { FileTreeNode, PathTarget } from "../../shared/ipc.js";
import { execBuffer } from "../exec.js";
import { isErrnoException } from "../errors/utils.js";
import { normalizeRelativePath, resolvePathUnderRoot, statExisting } from "./utils.js";

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
// 実在する通常ファイルとディレクトリを、worktree の中なら worktree 基準の相対パス (ルート自身は "") で、
// 外なら絶対パスで返す。それ以外は null。
export async function resolvePathTarget(
  workingRoot: string,
  targetPath: string,
): Promise<PathTarget | null> {
  const basePath = path.resolve(workingRoot);
  const absolutePath = path.resolve(basePath, targetPath);
  const relative = path.relative(basePath, absolutePath);
  const stats = await statExisting(absolutePath);
  const kind = stats?.isFile() ? "file" : stats?.isDirectory() ? "directory" : null;
  if (!kind) {
    return null;
  }
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { kind, path: absolutePath };
  }
  return { kind, path: normalizeRelativePath(relative) };
}

// HTML プレビュー対象の解決。worktree 内なら root=worktree ルート、外なら root=entry の
// 親ディレクトリ (相対参照される CSS / JavaScript は大抵同じディレクトリにある)。
export async function resolveHtmlPreviewEntry(
  workingRoot: string,
  filePath: string,
): Promise<{ root: string; path: string } | null> {
  const target = await resolvePathTarget(workingRoot, filePath);
  if (target?.kind !== "file") {
    return null;
  }
  if (path.isAbsolute(target.path)) {
    return { root: path.dirname(target.path), path: path.basename(target.path) };
  }
  return { root: workingRoot, path: target.path };
}

// 編集モードの seed 用。既存テキストは内容 (空は "")、不在は null、範囲外は throw。
export async function readWorktreeFile(
  workingRoot: string,
  filePath: string,
): Promise<string | null> {
  const targetPath = resolvePathUnderRoot(workingRoot, filePath);
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
  const targetPath = resolvePathUnderRoot(workingRoot, filePath);
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

// rootPath の下の 1 ディレクトリの中身。ノードの path は rootPath からの相対パス。
// ディレクトリが無ければ null (表示中のディレクトリが消えるのは普通に起こる)。
export async function listDirectory(
  rootPath: string,
  relativePath: string,
): Promise<FileTreeNode[] | null> {
  const targetPath = resolvePathUnderRoot(rootPath, relativePath);
  const entries = await readDirectoryEntries(targetPath);
  if (!entries) {
    return null;
  }

  const nodes = await Promise.all(
    entries
      .filter((entry) => entry.name !== ".git")
      .map(async (entry) => {
        const entryPath = path.join(targetPath, entry.name);
        const entryRelativePath = normalizeRelativePath(path.relative(rootPath, entryPath));
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

// 不在は null。ディレクトリでないもの (ENOTDIR) も、ディレクトリとしては不在として扱う。
async function readDirectoryEntries(directoryPath: string): Promise<fs.Dirent[] | null> {
  try {
    return await fs.promises.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return null;
    }
    throw error;
  }
}
