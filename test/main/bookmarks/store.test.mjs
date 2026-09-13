import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-bookmarks-store-"));
process.env.YURU_HOME = path.join(testRoot, "yuru-home");

const {
  addBookmarks,
  addImageBookmark,
  loadAllBookmarks,
  loadBookmarks,
  removeBookmark,
  removeBookmarks,
  updateBookmarkTitle,
  updateBookmarkTitles,
} = await import("../../../src/main/bookmarks/store.ts");
const { saveBookmarkImage } = await import("../../../src/main/bookmarks/image.ts");

const worktreePath = path.join(testRoot, "worktree-a");
const otherWorktreePath = path.join(testRoot, "worktree-b");
const pngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

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

  // 同じ title への更新は書き込まない
  assert.equal(updateBookmarkTitle(worktreePath, added[0].url, "Example A"), false);
});

test("updateBookmarkTitles は複数 worktree の title をまとめて置き換える", () => {
  cleanBookmarks();
  addBookmarks(worktreePath, ["https://example.com/a"]);
  addBookmarks(otherWorktreePath, ["https://example.com/b"]);

  assert.equal(
    updateBookmarkTitles([
      { worktreePath, url: "https://example.com/a", title: "Example A" },
      { worktreePath: otherWorktreePath, url: "https://example.com/b", title: "Example B" },
      { worktreePath, url: "https://example.com/missing", title: "x" },
    ]),
    true,
  );
  assert.equal(loadBookmarks(worktreePath)[0].title, "Example A");
  assert.equal(loadBookmarks(otherWorktreePath)[0].title, "Example B");
  assert.equal(updateBookmarkTitles([]), false);
});

test("loadAllBookmarks は全 worktree のブックマークを 1 度で返す", () => {
  cleanBookmarks();
  addBookmarks(worktreePath, ["https://example.com/a"]);
  addBookmarks(otherWorktreePath, ["https://example.com/b"]);

  const all = loadAllBookmarks();
  assert.deepEqual(
    all.get(path.resolve(worktreePath)).map(({ url }) => url),
    ["https://example.com/a"],
  );
  assert.deepEqual(
    all.get(path.resolve(otherWorktreePath)).map(({ url }) => url),
    ["https://example.com/b"],
  );
});

test("addImageBookmark は kind: image で末尾に足し、同じ画像でも別の件にする", () => {
  cleanBookmarks();
  addBookmarks(worktreePath, ["https://example.com/a"]);
  const imageUrl = saveBookmarkImage(`data:image/png;base64,${pngBase64}`);
  const sameImageUrl = saveBookmarkImage(`data:image/png;base64,${pngBase64}`);
  addImageBookmark(worktreePath, imageUrl, "Pasted image");
  addImageBookmark(worktreePath, sameImageUrl, "Pasted image");

  const bookmarks = loadBookmarks(worktreePath);
  assert.deepEqual(
    bookmarks.map((bookmark) => bookmark.kind),
    [undefined, "image", "image"],
  );
  assert.equal(bookmarks[1].title, "Pasted image");
});

// 実体ファイルの後始末は呼び出し側 (service) が行うので、store は消した Bookmark を返すだけ。
test("removeBookmark は消した Bookmark を返す", () => {
  cleanBookmarks();
  const imageUrl = saveBookmarkImage(`data:image/png;base64,${pngBase64}`);
  addImageBookmark(worktreePath, imageUrl, "Pasted image");

  const removed = removeBookmark(worktreePath, imageUrl);
  assert.equal(removed.kind, "image");
  assert.equal(removed.url, imageUrl);
  assert.deepEqual(loadBookmarks(worktreePath), []);
  // store はファイルに触らない
  assert.equal(fs.existsSync(fileURLToPath(imageUrl)), true);

  assert.equal(removeBookmark(worktreePath, "https://example.com/missing"), null);
});

test("removeBookmarks は消した Bookmark をすべて返す", () => {
  cleanBookmarks();
  const imageUrl = saveBookmarkImage(`data:image/png;base64,${pngBase64}`);
  addBookmarks(worktreePath, ["https://example.com/a"]);
  addImageBookmark(worktreePath, imageUrl, "Pasted image");

  const removed = removeBookmarks(worktreePath);
  assert.deepEqual(
    removed.map((bookmark) => bookmark.url),
    ["https://example.com/a", imageUrl],
  );
  assert.deepEqual(removeBookmarks(path.join(testRoot, "never-registered")), []);
});

test("removeBookmarks は worktree のブックマークをすべて消す", () => {
  cleanBookmarks();
  addBookmarks(worktreePath, ["https://example.com/a"]);
  addBookmarks(otherWorktreePath, ["https://example.com/b"]);
  removeBookmarks(worktreePath);
  assert.deepEqual(loadBookmarks(worktreePath), []);
  assert.equal(loadBookmarks(otherWorktreePath).length, 1);
});
