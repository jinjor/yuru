import fs from "fs";
import path from "path";
import { getYuruHome } from "../yuru-home.js";

// 履歴は補完候補として使うだけなので、古い分は捨てる。
const MAX_RECENT_FILES = 50;

interface RecentFileStore {
  repos: Record<string, string[]>;
}

// repo 内の相対パスを、新しく開いた順に返す。
// 同じ repo の worktree はすべて同じ履歴を共有する。
export function loadRecentFiles(repoPath: string): string[] {
  return loadStore().repos[path.resolve(repoPath)] ?? [];
}

export function addRecentFile(repoPath: string, filePath: string): void {
  const store = loadStore();
  const repoKey = path.resolve(repoPath);
  const previous = store.repos[repoKey] ?? [];
  store.repos[repoKey] = [filePath, ...previous.filter((entry) => entry !== filePath)].slice(
    0,
    MAX_RECENT_FILES,
  );
  saveStore(store);
}

function getRecentFilesPath(): string {
  return path.join(getYuruHome(), "recent-files.json");
}

function parseStore(value: unknown): RecentFileStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Recent files must be a JSON object.");
  }
  const reposValue = (value as { repos?: unknown }).repos;
  if (!reposValue || typeof reposValue !== "object" || Array.isArray(reposValue)) {
    throw new Error("Recent files `repos` must be an object.");
  }

  const repos: Record<string, string[]> = {};
  for (const [repoPath, pathsValue] of Object.entries(reposValue)) {
    if (!Array.isArray(pathsValue)) {
      throw new Error(`Recent files for "${repoPath}" must be an array.`);
    }
    for (const filePath of pathsValue) {
      if (typeof filePath !== "string") {
        throw new Error(`Recent file path in "${repoPath}" must be a string.`);
      }
    }
    repos[repoPath] = pathsValue;
  }
  return { repos };
}

function loadStore(): RecentFileStore {
  const storePath = getRecentFilesPath();
  if (!fs.existsSync(storePath)) {
    return { repos: {} };
  }
  return parseStore(JSON.parse(fs.readFileSync(storePath, "utf8")));
}

function saveStore(store: RecentFileStore): void {
  const storePath = getRecentFilesPath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
}
