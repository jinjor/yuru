import fs from "fs";
import path from "path";
import { sessionsDir } from "./claude-paths.js";

export interface ActiveSessionInfo {
  sessionId: string;
  cwd: string;
}

type StateChangeCallback = (active: ActiveSessionInfo[]) => void;

export class SessionWatcher {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private previous = new Map<string, string>();
  private callbacks: StateChangeCallback[] = [];

  start(): void {
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }

    this.previous = this.scan();
    this.watcher = fs.watch(sessionsDir, () => {
      this.scheduleUpdate();
    });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  onStateChange(callback: StateChangeCallback): void {
    this.callbacks.push(callback);
  }

  private scheduleUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.checkForChanges();
    }, 200);
  }

  private checkForChanges(): void {
    const current = this.scan();

    let changed = current.size !== this.previous.size;
    if (!changed) {
      for (const [sessionId, cwd] of current) {
        if (this.previous.get(sessionId) !== cwd) {
          changed = true;
          break;
        }
      }
    }

    if (!changed) {
      return;
    }

    this.previous = current;
    const active = Array.from(current, ([sessionId, cwd]) => ({ sessionId, cwd }));
    for (const callback of this.callbacks) {
      callback(active);
    }
  }

  private scan(): Map<string, string> {
    const result = new Map<string, string>();
    if (!fs.existsSync(sessionsDir)) {
      return result;
    }

    let files: string[];
    try {
      files = fs.readdirSync(sessionsDir);
    } catch {
      return result;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      try {
        const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), "utf-8"));
        if (typeof data.sessionId === "string" && typeof data.cwd === "string") {
          result.set(data.sessionId, data.cwd);
        }
      } catch {
        // Skip partial or malformed session files.
      }
    }

    return result;
  }
}
