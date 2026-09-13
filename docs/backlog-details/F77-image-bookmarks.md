# F77 画像のブックマーク

Last updated: 2026-09-12

`F77`（現行の ID 割り当て: 画像のブックマーク）の設計メモ。
`F77-bookmark-status.md` / `F77-ui-design.md` は ID が振り直される前の
「ブックマークのステータス表示」の設計記録（実装・merge 済み）で、本 doc とは別内容。

取り込み先の compose 欄そのものは [F82-input-bookmark.md](F82-input-bookmark.md) が持つ。
UI モックアップ: [../mockups/F82-F77-bookmark-additions.html](../mockups/F82-F77-bookmark-additions.html)

## 要件

- 参考資料の画像をブックマークしたい
- **取り込みはクリップボードからの貼り付けだけ**（ユーザー指定）。ドラッグ&ドロップ・ファイル選択・
  URL からの画像取得は作らない
- 貼り付け先は F82 の compose 欄。チャットに画像を貼ったときのように、その欄に添付として表示してから登録する

## 前提（現状の実装）

- ブックマークは `{ url, title, status?, renamable? }`（`src/shared/ipc.ts`）。`url` が重複判定・削除・
  リネームのキーとして store / IPC / UI を一貫して貫いている
- `renameBookmark` は `parseGitHubItemUrl(url)` に一致する URL（GitHub issue/PR）だけ拒否する
  (`service.ts:1182`)。それ以外は無条件でリネーム可
- `openExternal` は main 側で **http/https のみ**を許可する（`F71` の決定）。ここは緩めない
- renderer は `loadFile` で `file://…/renderer/index.html` を読み込み、`webSecurity` は既定（有効）、
  メイン画面に CSP は掛けていない（`HTML_PREVIEW_CSP` は HTML プレビュー専用の別 protocol）
- プレビューは worktree 外の絶対パスを既に開ける（ターミナルのファイルリンク用）。画像も
  `getImageFileDocument` で git を通さずに読む経路がある（「開く」の節を参照）

## データモデル

`url` を画像の識別子としてもそのまま使う。**新しい ID の概念は増やさない** — 重複判定・削除・
リネーム・（将来の並び替え）の仕組みを、そのまま画像にも使い回すため。

- 貼り付けた画像は `~/.yuru/bookmark-images/<uuid>.<ext>` に保存する（`getYuruHome()` 配下、
  `bookmarks.json` と同じ親ディレクトリ）
- その絶対パスを Node 標準の `url.pathToFileURL` で `file://` URL にして `Bookmark.url` に入れる
  （文字列連結ではなく URL の仕様に沿った変換にする。空白や非 ASCII のエスケープもこれで済む）
- `Bookmark` に判別用の `kind` を足す。省略時は既存のリンク型（後方互換。今の `bookmarks.json` に `kind` は無い）

```ts
export interface Bookmark {
  url: string;
  title: string;
  kind?: "image"; // 省略 = リンク。画像だけ "image"
  status?: GitHubItem;
  renamable?: boolean;
}
```

- 既定タイトルは `"Pasted image"` 固定。一覧ではサムネイルが実体を示すので、タイトルはラベル以上の
  意味を持たせない。`file://` URL は `parseGitHubItemUrl` に一致しないので、**リネームは
  追加実装なしでそのまま動く**（`renamable: !parseGitHubItemUrl(url)` が true になる）
- GitHub ステータスのポーリング（`github-status-monitor`）も同じ判定で対象を選ぶので、画像は自動的に対象外

## 取り込み: compose 欄への貼り付け

F82 の compose 欄が `paste` を受ける。**ペイン全体で `paste` を拾う仕組みは作らない** —
入力欄が常設されていて、そこが貼り付け先だと見えているので、ペインのフォーカス管理
（コンテナの `tabIndex`、タブ切り替え時のフォーカス送り）は要らない。

1. `event.clipboardData.items` から `type` が `image/` で始まる最初の item を探す
2. 見つからなければ何もしない（テキストの貼り付けはそのまま入力欄に入る）
3. 見つかったら `preventDefault()` し、`item.getAsFile()` → `FileReader.readAsDataURL` で
   dataURL にして、compose 欄を **添付チップの表示**に切り替える
   - チップ = サムネイル + `Pasted image` + `×`（破棄）。テキスト入力は隠す。
     1 件のブックマークはリンクか画像のどちらかなので、両方を同時に持たせない
4. **Enter で確定** し、`addImageBookmark(worktreeId, dataUrl)` を呼ぶ。Escape または `×` で破棄

貼った瞬間に登録せず Enter を挟むのは、チャットの添付と同じ形にするため。誤って貼ったものが
そのままファイル書き込みと一覧への追加になるのも避けられる。

Electron の `clipboard.readImage()`（main 側 API）は使わない。DOM の `paste` イベントは貼り付け元が
持っていた MIME とバイト列をそのまま渡すので、`nativeImage` 経由の強制 PNG 再エンコードが要らない。

## 保存: `addImageBookmark(worktreeId, dataUrl)`

- dataURL の `data:<mime>;base64,` から mime を取り、拡張子に変換する。対応は `image/png`
  `image/jpeg` `image/gif` `image/webp` のみ。それ以外（`image/svg+xml` など）は
  `"Unsupported image type."` で拒否する
- base64 を `Buffer.from(base64, "base64")` にデコードし、`~/.yuru/bookmark-images/<uuid>.<ext>` へ書く
  （uuid は `crypto.randomUUID()`）
- 書き込みに成功したら store へ `{ url: pathToFileURL(...).href, title: "Pasted image", kind: "image" }`
  を追加し、`bookmarksChanged` を発火する。store 書き込みが失敗したら、書いたファイルを消して
  孤児を残さない
- 重複判定はしない。貼るたびに別の uuid で別ファイルになる（同じ画像を 2 回貼れば 2 件）

## 表示: `<img src={bookmark.url}>` で直接読む

サムネイル取得用の IPC は作らない。`Bookmark.url` がそのまま `file://` URL なので、行の
`<img>` の `src` に渡せばよい。

`getImageDiffDocument` が dataURL を IPC で運んでいるのは、diff の「変更前」側が git blob で
**ディスク上にパスを持たない**ため。画像ブックマークは実ファイルとして永続化されるので事情が違う。
renderer 自身が `file://` origin で、CSP も掛かっておらず、`webSecurity` の既定は
`file://` ページから `file://` リソースを `<img>` で読むことを妨げない。

これにより、IPC・main 側のパス検証・renderer 側の dataURL キャッシュがまとめて不要になる
（再読み込みはブラウザの画像キャッシュが吸収する）。

行のレイアウト:

- `kind === "image"` の行は、タイトルの左にサムネイル（36×36、`object-fit: cover`、角丸）を置く。
  読み込み前のプレースホルダは置かない（`F77-ui-design.md` の「ステータス未取得は何も出さない」と同じ）
- meta 行（`bookmark-meta` / `bookmark-url`）は画像では出さない。`file://…/<uuid>.png` を
  URL として見せても意味がない。表示条件 `bookmark.status || bookmark.title !== bookmark.url` から
  画像を除外する
- `.bookmark-open` は今タイトルを縦に積む `flex-direction: column` 一本。画像行だけ
  `.bookmark-open.has-thumbnail` でサムネイル + タイトルの横並びにし、タイトルの
  `-webkit-line-clamp` を 1 行に落とす（サムネイルのぶん横幅が減るので 2 行だと窮屈）

## 開く: 既存のプレビューにそのまま乗せる

画像用の「開く」IPC は作らない。**行のクリックで `previewSelection` に保存先の絶対パスを入れる**だけで、
既存のプレビューがそのまま画像を表示する。ファイルをプレビューで開くという、アプリの他の場所と同じ挙動になる。

成立する理由（既存実装の確認済みの事実）:

- `service.getImageDiffDocument` は `path.isAbsolute(filePath)` のとき git を通さず
  `getImageFileDocument(filePath)` に分岐する。worktree 外の絶対パス（ターミナルのファイルリンク由来）
  のために既にある経路
- `getImageFileDocument` は `{ original: side, current: side }` と同じ中身を両側に返すので、
  `ImagePreview` の「片側だけ = 追加または削除」の判定に入らず、**Added / Deleted のラベルなしで
  1 枚の画像**として描かれる
- `DiffPreviewPanel` の種別判定は拡張子ベース。保存名を `<uuid>.<ext>` にしてあるので image に振り分けられる
  （mime から拡張子を決めておくことが、ここでも効いてくる）
- 外部パスは編集モードと Reviewed の対象外にする判定も既にある（`isExternalPath`）

必要な変更は、`BookmarksPane` に `onPreviewSelectionChange` を渡すことだけ。`ExplorerPanel` は
Changes / Search / Files の 3 ペインに既に同じ prop を渡している。呼び方も
`WorktreeView` のファイルリンク（`setPreviewSelection({ path: resolvedPath })`）と同じ。

リンクのブックマークは今まで通り `openExternal` で既定ブラウザ。`openExternal` が http/https 専用
という `F71` の決定も変えない。行のクリックの呼び先だけ `kind` で分岐する。

なお外部パスのプレビューは 3 秒ごとに内容を読み直す（`shouldPollContent`）。ブックマークの画像は
変わらないので無駄になるが、**プレビュー側に「ブックマーク画像のときは poll しない」という例外は入れない**。
外部ファイルの扱いはプレビューの一般則のままにする。

## 削除

`removeBookmark` / `removeBookmarks`（`src/main/bookmarks/store.ts`）が `kind: "image"` の
エントリを取り除くとき、対応するファイルも `fs.unlink` する。

- 単体削除と、worktree 削除時の一括削除（`service.ts:1074` の `removeStoredBookmarks`）の
  どちらも同じ store 関数を通るので、1 箇所に書けば両方に効く
- ファイル削除の失敗（先に手で消していた等）はベストエフォートにして、JSON からの削除は失敗させない（警告に留める）

## 作るもの

- `src/shared/ipc.ts`: `Bookmark.kind` の追加。`addImageBookmark` を `ElectronAPI` に追加
- `src/main/bookmarks/store.ts`: `addImageBookmark`（insert のみ、重複判定なし）。
  `removeBookmark` / `removeBookmarks` に画像ファイルの unlink を追加。`loadStore` の検証に `kind` の許容値チェック
- `src/main/service.ts`: `addImageBookmark` のハンドラ（mime 判定、`bookmark-images` ディレクトリの作成、
  ファイル書き込み）
- `src/main/index.ts` / `src/preload/index.ts`: IPC 1 本の配線
- `src/renderer/explorer/ExplorerPanel.tsx`: `BookmarksPane` に `onPreviewSelectionChange` を渡す
- `src/renderer/bookmarks/BookmarksPane.tsx`: compose 欄の `paste` と添付チップ、画像行のサムネイルと
  クリック先の分岐（リンクは `openExternal`、画像は `previewSelection`）
- `src/renderer/style.css`: `.bookmark-thumbnail` と、画像行用の `.bookmark-open.has-thumbnail`、添付チップ

## 却下・スコープ外にした案

- **サムネイル取得用 IPC（`getBookmarkImage`）**: 上記のとおり `<img src>` で直接読めるので不要
- **`shell.openPath` で OS 既定のビューアを開く**（`openBookmarkImage` IPC）: 既存のプレビューが
  worktree 外の絶対パスをそのまま開けるので、IPC を足してまでアプリの外に出す理由が無い
- **ペイン全体で `paste` を拾う**: 常設の compose 欄があるなら、貼り付け先はそこで十分。
  ペインのフォーカス管理を足す理由が無くなった
- **ドラッグ&ドロップ / ファイル選択での追加**: ユーザー指定によりスコープ外。ローカルファイル全般は `F76` の範囲
- **サムネイル生成（縮小画像の作成）**: 貼り付け画像は現実的なサイズに収まるので、フルサイズを
  CSS で縮小すれば足りる。`sharp` などの依存を足すコストに見合わない
- **`nativeImage` / `clipboard.readImage()` での取り込み**: DOM の `paste` の方が MIME 保持の点で単純
- **画像サイズの上限**: 設けない。実際に問題が出てから対処する（YAGNI）
- **compose 欄でタイトルも一緒に入力する**（チャットのキャプション相当）: 画像を添付した状態で
  打った文字をタイトルにする案。同じ欄が「URL」と「タイトル」の 2 つの意味を持つので、
  まずは既定タイトル + 既存のリネームで様子を見る

## 未決事項

- （現時点ではなし）
