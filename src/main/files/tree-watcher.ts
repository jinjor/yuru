import fs from "fs";
import { normalizeRelativePath, resolvePathUnderRoot } from "./utils.js";

type FileTreeChangeCallback = (worktreeId: string, relativePath: string) => void;

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

export class FileTreeWatcher {
  private worktreeId: string | null = null;
  private workingRootPath: string | null = null;
  private watchers = new Map<string, fs.FSWatcher>();
  private pendingPaths = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onChange: FileTreeChangeCallback) {}

  async syncWorktreeTargets(
    worktreeId: string,
    workingRoot: string,
    relativePaths: readonly string[],
  ): Promise<void> {
    const nextTargets = new Set(relativePaths.map(normalizeRelativePath));

    if (
      (this.worktreeId && this.worktreeId !== worktreeId) ||
      (this.workingRootPath && this.workingRootPath !== workingRoot)
    ) {
      this.clear();
    }
    this.worktreeId = worktreeId;
    this.workingRootPath = workingRoot;

    for (const watchedPath of Array.from(this.watchers.keys())) {
      if (nextTargets.has(watchedPath)) {
        continue;
      }
      this.closeWatcher(watchedPath);
    }

    for (const relativePath of nextTargets) {
      if (this.watchers.has(relativePath)) {
        continue;
      }

      const absolutePath = resolvePathUnderRoot(workingRoot, relativePath);
      if (!(await isDirectory(absolutePath))) {
        continue;
      }

      try {
        const watcher = fs.watch(absolutePath, () => {
          this.scheduleEmit(relativePath);
        });
        watcher.on("error", () => {
          this.closeWatcher(relativePath);
        });
        this.watchers.set(relativePath, watcher);
      } catch {
        // Ignore directories that cannot be watched.
      }
    }

    if (this.watchers.size === 0) {
      this.clear();
      return;
    }
  }

  clearWorktree(worktreeId: string): void {
    if (this.worktreeId !== worktreeId) {
      return;
    }
    this.clear();
  }

  stop(): void {
    this.clear();
  }

  private clear(): void {
    for (const relativePath of Array.from(this.watchers.keys())) {
      this.closeWatcher(relativePath);
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingPaths.clear();
    this.worktreeId = null;
    this.workingRootPath = null;
  }

  private scheduleEmit(relativePath: string): void {
    this.pendingPaths.add(relativePath);
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.worktreeId) {
        return;
      }
      for (const pendingPath of this.pendingPaths) {
        this.onChange(this.worktreeId, pendingPath);
      }
      this.pendingPaths.clear();
    }, 120);
  }

  private closeWatcher(relativePath: string): void {
    const watcher = this.watchers.get(relativePath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(relativePath);
    }
    this.pendingPaths.delete(relativePath);
  }
}
