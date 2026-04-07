import fs from "fs";
import path from "path";
import { getGitPathStates } from "./git.js";

export interface FileTreeNode {
  id: string;
  path: string;
  name: string;
  kind: "file" | "directory";
  children: FileTreeNode[] | null;
  gitStatus?: string;
  isIgnored: boolean;
}

export interface FileContent {
  path: string;
  content: string;
  isBinary: boolean;
  size: number;
}

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

function getStatusPriority(status: string): number {
  switch (status) {
    case "A":
    case "R":
    case "??":
      return 3;
    case "M":
      return 2;
    default:
      return 0;
  }
}

export async function listFiles(cwd: string, relativePath = ""): Promise<FileTreeNode[]> {
  const targetPath = resolveSessionPath(cwd, relativePath);
  const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
  const gitStates = await getGitPathStates(cwd);

  const statusByPath = new Map<string, string>();
  const ignoredPaths = new Set<string>();
  for (const state of gitStates) {
    if (state.ignored) {
      ignoredPaths.add(state.path);
      continue;
    }
    const existing = statusByPath.get(state.path);
    if (!existing || getStatusPriority(state.status) > getStatusPriority(existing)) {
      statusByPath.set(state.path, state.status);
    }
  }

  const aggregateStatusByPath = new Map<string, string>();
  for (const [statePath, status] of statusByPath) {
    const segments = statePath.split("/");
    for (let i = 1; i <= segments.length; i++) {
      const currentPath = segments.slice(0, i).join("/");
      const existing = aggregateStatusByPath.get(currentPath);
      if (!existing || getStatusPriority(status) > getStatusPriority(existing)) {
        aggregateStatusByPath.set(currentPath, status);
      }
    }
  }

  const nodes = await Promise.all(
    entries
      .filter((entry) => entry.name !== ".git")
      .map(async (entry) => {
        const entryPath = path.join(targetPath, entry.name);
        const entryRelativePath = normalizeRelativePath(path.relative(cwd, entryPath));
        const isDirectory = await detectDirectory(entryPath, entry);
        const isIgnored = Array.from(ignoredPaths).some(
          (ignoredPath) =>
            entryRelativePath === ignoredPath || entryRelativePath.startsWith(`${ignoredPath}/`),
        );
        return {
          id: entryRelativePath,
          path: entryRelativePath,
          name: entry.name,
          kind: isDirectory ? "directory" : "file",
          children: isDirectory ? [] : null,
          gitStatus: aggregateStatusByPath.get(entryRelativePath),
          isIgnored,
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
