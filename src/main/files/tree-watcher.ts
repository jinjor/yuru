import fs from "fs";
import { isErrnoException } from "../errors/utils.js";
import { normalizeRelativePath, resolvePathUnderRoot } from "./utils.js";

type FileTreeChangeCallback = (rootPath: string, relativePath: string) => void;

// 監視を頼まれるまでの間に消えたディレクトリ (ディレクトリでなくなったものを含む) は null。
function watchDirectory(absolutePath: string, listener: () => void): fs.FSWatcher | null {
  try {
    return fs.watch(absolutePath, listener);
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return null;
    }
    throw error;
  }
}

// Files のツリーの監視。ツリーのルートごとに、その下の展開中のディレクトリを 1 つずつ監視する。
export class FileTreeWatcher {
  // ルートの絶対パス → ルートからの相対パス → 監視。
  private readonly roots = new Map<string, Map<string, fs.FSWatcher>>();
  // まだ通知していない変更のあったディレクトリ。ルートの絶対パス → ルートからの相対パス。
  private readonly pendingChanges = new Map<string, Set<string>>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onChange: FileTreeChangeCallback;

  constructor(onChange: FileTreeChangeCallback) {
    this.onChange = onChange;
  }

  // rootPath の監視を、その下の relativePaths のディレクトリに置き換える。空ならやめる。
  // 他のルートの監視には触れない。
  sync(rootPath: string, relativePaths: readonly string[]): void {
    const nextTargets = new Set(relativePaths.map(normalizeRelativePath));
    const watchers = this.roots.get(rootPath) ?? new Map<string, fs.FSWatcher>();
    for (const watchedPath of Array.from(watchers.keys())) {
      if (!nextTargets.has(watchedPath)) {
        this.closeWatcher(rootPath, watchedPath);
      }
    }
    for (const relativePath of nextTargets) {
      if (watchers.has(relativePath)) {
        continue;
      }
      const watcher = watchDirectory(resolvePathUnderRoot(rootPath, relativePath), () => {
        this.scheduleEmit(rootPath, relativePath);
      });
      if (!watcher) {
        continue;
      }
      // 監視できなくなったディレクトリ (消えた場合など) は監視をやめる。消えたことは、
      // 変更の通知を受けた renderer が読み直して知る。
      watcher.on("error", () => {
        if (this.roots.get(rootPath)?.get(relativePath) === watcher) {
          this.closeWatcher(rootPath, relativePath);
        }
      });
      watchers.set(relativePath, watcher);
      this.roots.set(rootPath, watchers);
    }
  }

  stopRoot(rootPath: string): void {
    for (const relativePath of Array.from(this.roots.get(rootPath)?.keys() ?? [])) {
      this.closeWatcher(rootPath, relativePath);
    }
  }

  stop(): void {
    for (const rootPath of Array.from(this.roots.keys())) {
      this.stopRoot(rootPath);
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private scheduleEmit(rootPath: string, relativePath: string): void {
    const pendingPaths = this.pendingChanges.get(rootPath) ?? new Set<string>();
    pendingPaths.add(relativePath);
    this.pendingChanges.set(rootPath, pendingPaths);
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const changes = Array.from(this.pendingChanges);
      this.pendingChanges.clear();
      for (const [changedRoot, changedPaths] of changes) {
        for (const changedPath of changedPaths) {
          this.onChange(changedRoot, changedPath);
        }
      }
    }, 120);
  }

  // 監視をやめたディレクトリの未通知の変更も捨てる。空になったルートは消す。
  private closeWatcher(rootPath: string, relativePath: string): void {
    const watchers = this.roots.get(rootPath);
    const watcher = watchers?.get(relativePath);
    if (watchers && watcher) {
      watcher.close();
      watchers.delete(relativePath);
      if (watchers.size === 0) {
        this.roots.delete(rootPath);
      }
    }
    const pendingPaths = this.pendingChanges.get(rootPath);
    pendingPaths?.delete(relativePath);
    if (pendingPaths?.size === 0) {
      this.pendingChanges.delete(rootPath);
    }
  }
}
