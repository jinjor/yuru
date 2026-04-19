import fs from "fs";
import path from "path";
import { FileTreeNode } from "../shared/ipc.js";
import { execBuffer } from "./exec.js";

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function resolveSessionPath(cwd: string, relativePath = ""): string {
  const basePath = path.resolve(cwd);
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

export function resolveRepoFile(cwd: string, filePath: string): string | null {
  try {
    const basePath = path.resolve(cwd);
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(basePath, filePath);
    const relative = path.relative(basePath, absPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }
    if (!fs.statSync(absPath).isFile()) {
      return null;
    }
    return normalizeRelativePath(relative);
  } catch {
    return null;
  }
}

export async function listAllFiles(cwd: string): Promise<string[]> {
  const [trackedBuffer, untrackedBuffer] = await Promise.all([
    execBuffer("git", ["ls-files", "-z", "--cached", "--stage"], cwd),
    execBuffer("git", ["ls-files", "-z", "--others", "--exclude-standard"], cwd),
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

export async function listFiles(cwd: string, relativePath = ""): Promise<FileTreeNode[]> {
  const targetPath = resolveSessionPath(cwd, relativePath);
  const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });

  const nodes = await Promise.all(
    entries
      .filter((entry) => entry.name !== ".git")
      .map(async (entry) => {
        const entryPath = path.join(targetPath, entry.name);
        const entryRelativePath = normalizeRelativePath(path.relative(cwd, entryPath));
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

