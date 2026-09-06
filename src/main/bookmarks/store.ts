import fs from "fs";
import path from "path";
import type { Bookmark } from "../../shared/ipc.js";
import { getYuruHome } from "../yuru-home.js";

interface BookmarkStore {
  worktrees: Record<string, Bookmark[]>;
}

const storePath = () => path.join(getYuruHome(), "bookmarks.json");

function loadStore(): BookmarkStore {
  if (!fs.existsSync(storePath())) {
    return { worktrees: {} };
  }
  const value = JSON.parse(fs.readFileSync(storePath(), "utf8")) as {
    worktrees?: unknown;
  };
  if (!value.worktrees || typeof value.worktrees !== "object" || Array.isArray(value.worktrees)) {
    throw new Error("Bookmarks must contain a worktrees object.");
  }
  for (const bookmarks of Object.values(value.worktrees)) {
    if (
      !Array.isArray(bookmarks) ||
      bookmarks.some(
        (bookmark) =>
          !bookmark ||
          typeof bookmark !== "object" ||
          typeof bookmark.url !== "string" ||
          typeof bookmark.title !== "string",
      )
    ) {
      throw new Error("Bookmarks must contain URL and title strings.");
    }
  }
  return value as BookmarkStore;
}

function saveStore(store: BookmarkStore): void {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), `${JSON.stringify(store, null, 2)}\n`);
}

export function loadBookmarks(worktreePath: string): Bookmark[] {
  return loadStore().worktrees[path.resolve(worktreePath)] ?? [];
}

// 全 worktree のブックマーク。ステータスのポーリングが tick ごとに全体を見るので、
// worktree ごとに読み直さずに 1 回で済ませる。キーは path.resolve 済みの worktree path。
export function loadAllBookmarks(): Map<string, Bookmark[]> {
  return new Map(Object.entries(loadStore().worktrees));
}

export function addBookmarks(worktreePath: string, urls: readonly string[]): Bookmark[] {
  const store = loadStore();
  const key = path.resolve(worktreePath);
  const bookmarks = store.worktrees[key] ?? [];
  const known = new Set(bookmarks.map(({ url }) => url));
  const added = urls.flatMap((url) => {
    if (known.has(url)) {
      return [];
    }
    known.add(url);
    return [{ url, title: url }];
  });
  if (added.length > 0) {
    store.worktrees[key] = [...bookmarks, ...added];
    saveStore(store);
  }
  return added;
}

export function removeBookmark(worktreePath: string, url: string): void {
  const store = loadStore();
  const key = path.resolve(worktreePath);
  const existing = store.worktrees[key];
  if (!existing) {
    return;
  }
  const bookmarks = existing.filter((bookmark) => bookmark.url !== url);
  if (bookmarks.length === existing.length) {
    return;
  }
  if (bookmarks.length > 0) {
    store.worktrees[key] = bookmarks;
  } else {
    delete store.worktrees[key];
  }
  saveStore(store);
}

export function updateBookmarkTitle(worktreePath: string, url: string, title: string): boolean {
  return updateBookmarkTitles([{ worktreePath, url, title }]);
}

// まとめて書けるようにしてあるのは、ポーリングが 1 回の tick で複数の title を
// 更新しうるため。1 度の読み書きで済ませる。
export function updateBookmarkTitles(
  updates: readonly { worktreePath: string; url: string; title: string }[],
): boolean {
  if (updates.length === 0) {
    return false;
  }
  const store = loadStore();
  let changed = false;
  for (const { worktreePath, url, title } of updates) {
    const bookmark = store.worktrees[path.resolve(worktreePath)]?.find(
      (entry) => entry.url === url,
    );
    if (bookmark && bookmark.title !== title) {
      bookmark.title = title;
      changed = true;
    }
  }
  if (changed) {
    saveStore(store);
  }
  return changed;
}

export function removeBookmarks(worktreePath: string): void {
  const store = loadStore();
  const key = path.resolve(worktreePath);
  if (key in store.worktrees) {
    delete store.worktrees[key];
    saveStore(store);
  }
}
