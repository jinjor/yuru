import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-bookmarks-store-"));
process.env.YURU_HOME = path.join(testRoot, "yuru-home");

const { addBookmarks, loadBookmarks, removeBookmark, removeBookmarks, updateBookmarkTitle } =
  await import("../../../src/main/bookmarks/store.ts");

const worktreePath = path.join(testRoot, "worktree-a");
const otherWorktreePath = path.join(testRoot, "worktree-b");

function cleanBookmarks() {
  removeBookmarks(worktreePath);
  removeBookmarks(otherWorktreePath);
}

test("addBookmarks は title に URL を仮 title として入れて追加順で保持する", () => {
  cleanBookmarks();
  const added = addBookmarks(worktreePath, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(added.length, 2);
  assert.equal(added[0].title, "https://example.com/a");

  const bookmarks = loadBookmarks(worktreePath);
  assert.deepEqual(
    bookmarks.map((bookmark) => bookmark.url),
    ["https://example.com/a", "https://example.com/b"],
  );
});

test("addBookmarks は URL が完全一致するものを追加しない", () => {
  cleanBookmarks();
  addBookmarks(worktreePath, ["https://example.com/a"]);
  const added = addBookmarks(worktreePath, [
    "https://example.com/a",
    "https://example.com/a",
    "https://example.com/b",
  ]);
  assert.deepEqual(
    added.map((bookmark) => bookmark.url),
    ["https://example.com/b"],
  );
  // クエリ違いは正規化せず別ブックマークとして扱う
  const withQuery = addBookmarks(worktreePath, ["https://example.com/a?x=1"]);
  assert.equal(withQuery.length, 1);
});

test("addBookmarks は worktree ごとに独立して記録する", () => {
  cleanBookmarks();
  addBookmarks(worktreePath, ["https://example.com/a"]);
  const added = addBookmarks(otherWorktreePath, ["https://example.com/a"]);
  assert.equal(added.length, 1);
  assert.equal(loadBookmarks(otherWorktreePath).length, 1);
});

test("removeBookmark は指定した URL だけ消し、空になった worktree の項目は残さない", () => {
  cleanBookmarks();
  const added = addBookmarks(worktreePath, ["https://example.com/a"]);
  removeBookmark(worktreePath, added[0].url);
  assert.deepEqual(loadBookmarks(worktreePath), []);

  const store = JSON.parse(
    fs.readFileSync(path.join(process.env.YURU_HOME, "bookmarks.json"), "utf8"),
  );
  assert.equal(store.worktrees[path.resolve(worktreePath)], undefined);

  // 存在しない URL / worktree の削除は何もしない
  removeBookmark(worktreePath, "https://example.com/missing");
  removeBookmarks(path.join(testRoot, "never-registered"));
});

test("updateBookmarkTitle は title だけを置き換える", () => {
  cleanBookmarks();
  const added = addBookmarks(worktreePath, ["https://example.com/a"]);
  assert.equal(updateBookmarkTitle(worktreePath, added[0].url, "Example A"), true);
  const bookmark = loadBookmarks(worktreePath)[0];
  assert.equal(bookmark.title, "Example A");
  assert.equal(bookmark.url, "https://example.com/a");

  // 既に消えた bookmark の更新は false
  assert.equal(updateBookmarkTitle(worktreePath, "https://example.com/missing", "x"), false);
});

test("removeBookmarks は worktree のブックマークをすべて消す", () => {
  cleanBookmarks();
  addBookmarks(worktreePath, ["https://example.com/a"]);
  addBookmarks(otherWorktreePath, ["https://example.com/b"]);
  removeBookmarks(worktreePath);
  assert.deepEqual(loadBookmarks(worktreePath), []);
  assert.equal(loadBookmarks(otherWorktreePath).length, 1);
});
