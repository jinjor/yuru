import fs from "fs";
import path from "path";

type FileTreeChangeCallback = (sessionId: string, relativePath: string) => void;

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function resolveWatchPath(cwd: string, relativePath: string): string {
  const basePath = path.resolve(cwd);
  const targetPath = relativePath ? path.resolve(basePath, relativePath) : basePath;
  const relative = path.relative(basePath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid path");
  }
  return targetPath;
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

export class FileTreeWatcher {
  private sessionId: string | null = null;
  private cwd: string | null = null;
  private watchers = new Map<string, fs.FSWatcher>();
  private pendingPaths = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onChange: FileTreeChangeCallback) {}

  async syncSessionTargets(
    sessionId: string,
    cwd: string,
    relativePaths: readonly string[],
  ): Promise<void> {
    const nextTargets = new Set(relativePaths.map(normalizeRelativePath));

    if (
      (this.sessionId && this.sessionId !== sessionId) ||
      (this.cwd && this.cwd !== cwd)
    ) {
      this.clear();
    }
    this.sessionId = sessionId;
    this.cwd = cwd;

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

      const absolutePath = resolveWatchPath(cwd, relativePath);
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

  clearSession(sessionId: string): void {
    if (this.sessionId !== sessionId) {
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
    this.sessionId = null;
    this.cwd = null;
  }

  private scheduleEmit(relativePath: string): void {
    this.pendingPaths.add(relativePath);
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.sessionId) {
        return;
      }
      for (const pendingPath of this.pendingPaths) {
        this.onChange(this.sessionId, pendingPath);
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
