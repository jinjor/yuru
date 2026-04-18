import fs from "fs";
import path from "path";
import { FileContent, FileTreeNode } from "../shared/ipc.js";

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

export function fileExists(cwd: string, relativePath: string): boolean {
  try {
    const targetPath = resolveSessionPath(cwd, relativePath);
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
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

export async function readFileContent(cwd: string, relativePath: string): Promise<FileContent> {
  const targetPath = resolveSessionPath(cwd, relativePath);
  const buffer = await fs.promises.readFile(targetPath);
  const isBinary = buffer.includes(0);

  return {
    path: normalizeRelativePath(relativePath),
    content: isBinary ? "" : buffer.toString("utf-8"),
    isBinary,
    size: buffer.byteLength,
  };
}
