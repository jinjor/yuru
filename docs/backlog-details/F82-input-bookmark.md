# F82 URL を入力してブックマークを追加

Last updated: 2026-09-12

`F82` の設計メモ。追加の入口である **compose 欄** はこの doc が持ち、そこへ画像を貼り付けたときの扱いは
[F77-image-bookmarks.md](F77-image-bookmarks.md) が持つ。

UI モックアップ: [../mockups/F82-F77-bookmark-additions.html](../mockups/F82-F77-bookmark-additions.html)

## 要件

- 任意の URL を直接入力して、ブックマークとして登録したい
- ターミナルに出た URL に限らず、ブラウザなどからコピーしてきた URL も登録できる

## 前提（現状の実装）

`F71` のクリック登録の実装時点で、URL を検証して追加する経路は main 側に揃っている。

- `window.electronAPI.addBookmark(worktreeId, url)` → `service.addBookmark`
  - `http` / `https` 以外は `"Only http/https URLs can be bookmarked."` で拒否
  - 追加後、title は `resolveUrlTitle` が非同期に解決する（GitHub issue/PR は `gh api`、他は `<title>` を fetch）。解決するまでは URL が仮 title
  - 同じ URL がすでにあれば `addBookmarks` がサイレントに無視する（重複判定は URL 文字列の完全一致）
- 呼び出し元は `TerminalPanel.tsx`（ターミナルの URL クリック）と `TerminalBar.tsx`（PR バッジのクリック）だけ

**F82 に足りないのは「UI からこの `addBookmark` を呼ぶ入口」だけ**で、IPC / service / store の変更は無い。

## 設計

### 一覧の下に、常設の compose 欄を置く

Bookmarks タブを「上＝スクロールする一覧、下＝常に見えている 1 行の入力欄」の構成にする。
チャットの入力欄と同じ配置で、`SearchPane` の「固定の入力欄 + スクロールする結果」を上下逆にしたもの。

```
┌ Bookmarks ────────────────┐
│ ブックマークの一覧         │ ← スクロールする
│ …                         │
│                           │
├───────────────────────────┤
│ [ Paste a URL or image  ] │ ← 常設。ここが唯一の追加口
└───────────────────────────┘
```

**なぜ常設か。** 開閉するトグルにすると、追加のたびに「ボタンを押す → 入力する」の 2 手になるうえ、
画像の貼り付け先（F77）も同じ欄にするので、閉じている間は貼り付け先が画面上に存在しないことになる。
常に見えている欄なら、URL も画像も「ここに入れる」で説明が終わる。

**なぜ下か。** 追加したものはリストの末尾に増えるので、入力した場所のすぐ上に結果が現れる。
上（ヘッダ）に置くと、操作する場所と結果が出る場所が画面の反対側に分かれる。

補足: 将来ブックマークの並び替えを入れても、この配置の理由は変わらない。
並び替えができるようになっても **追加されたものが末尾に入る**ことは変わらないため。

**左ペイン（RepoList）の「+ → モーダル」と揃えない理由。** worktree の作成はブランチ名など
複数の入力が要る、頻度の低い操作で、モーダルが向いている。ブックマークの追加は URL 1 つ
（または画像 1 枚）だけで、思いついたときにすぐ放り込みたい操作なので、常設の 1 行の方が合う。

### 構造

`BookmarksPane` は今、一覧そのもの (`<div className="file-tree bookmarks-pane">`) を返している。
これを「ペイン（flex 縦）＝ 一覧 + compose 欄」に分ける。`SearchPane` の `.code-search-pane` と同型。

```
.bookmarks-pane   flex: 1; min-height: 0; display: flex; flex-direction: column;
├── .file-tree    flex: 1; overflow: auto;   ← 行 or EmptyState（0 件でも欄は残る）
└── .bookmark-compose                        ← 固定。スクロールしない
```

### 操作

- **Enter**: 入力値を trim して `addBookmark(worktreeId, url)` を呼ぶ
- **Escape**: 入力を空にする（欄自体は閉じない。閉じるものが無い）
- **成功したときだけ入力を空にする。** 失敗（http/https 以外など）は `onError` のトーストを出し、
  入力はそのまま残して直せるようにする。rename が楽観的に閉じているのは「閉じる先の行」が
  あるからで、ここは常設なので残す方が素直
- 空のまま Enter は何もしない
- **追加に成功したら一覧を一番下までスクロールする。** 追加されたものは末尾に入るので、
  上の方を見ている最中だと、追加しても画面上は何も起きていないように見える

画像を貼り付けたときだけ、この欄は添付チップの表示に変わる（[F77](F77-image-bookmarks.md) 参照）。

### バリデーション・重複は既存の `addBookmark` に委ねる

- スキームなしの入力（`github.com/...`）は `URL.canParse` が false を返して拒否される。
  アドレスバーやリンクのコピーはスキームを含むので、`https://` の自動補完は作らない
- 重複 URL はサイレントに無視される（クリック登録と同じ挙動）。専用のメッセージは出さない
- URL の正規化はしない（`F71` の決定を継承）

## 作るもの

- `src/renderer/bookmarks/BookmarksPane.tsx`: ペインを「一覧 + compose 欄」に分ける。
  compose 欄の入力・送信・スクロール追従。`bookmarks.length === 0` で `EmptyState` だけを
  返している早期 return をやめる（0 件でも compose 欄は出す）
- `src/renderer/style.css`: `.bookmarks-pane` を flex 縦に変え、`.bookmark-compose` を足す

IPC・main・store の変更なし。

## 却下した案

- **「+」ボタンを押すと直下にインライン入力行が開く**（最初のモックアップ）。rename の
  「クリックした行がその場で入力に変わる」を新規追加に流用したもの。rename と違って
  入力行に対応する行が無いので、押したボタン（ヘッダの角）と入力欄が出る場所が離れて不自然だった
- **ヘッダの「+」→ ポップアップ**（RepoList と同じ形）。URL だけならこれでも成立するが、
  同じ欄で画像を受ける（F77）ことを考えると、一時的に開くフロートの中に画像を貼るのは
  チャットの添付という説明から遠ざかる
- **一覧の上に置く**。追加されたものが末尾に入るのに、入力欄が反対側にある
