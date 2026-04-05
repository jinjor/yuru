import fs from "fs";
import path from "path";

type ChangeCallback = () => void;

export class WorktreeWatcher {
  private watchers = new Map<string, fs.FSWatcher>();
  private callbacks: ChangeCallback[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  onChange(callback: ChangeCallback): void {
    this.callbacks.push(callback);
  }

  setRepos(repoPaths: string[]): void {
    const nextRepos = new Set(repoPaths);

    for (const [repoPath, watcher] of this.watchers) {
      if (nextRepos.has(repoPath)) {
        continue;
      }
      watcher.close();
      this.watchers.delete(repoPath);
    }

    for (const repoPath of nextRepos) {
      if (this.watchers.has(repoPath)) {
        continue;
      }

      const worktreesPath = path.join(repoPath, ".git", "worktrees");
      if (!fs.existsSync(worktreesPath)) {
        continue;
      }

      try {
        const watcher = fs.watch(worktreesPath, () => {
          this.scheduleEmit();
        });
        watcher.on("error", () => {
          watcher.close();
          this.watchers.delete(repoPath);
          this.scheduleEmit();
        });
        this.watchers.set(repoPath, watcher);
      } catch {
        // Ignore repos whose worktree metadata directories cannot be watched.
      }
    }
  }

  stop(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private scheduleEmit(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      for (const callback of this.callbacks) {
        callback();
      }
    }, 200);
  }
}
