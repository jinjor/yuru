# F8: 開いたファイルの位置を Files ツリーにも反映する

F8 の仕様。詳細設計の前提として「どういう条件で何が起きるか」を定める。

## 現状の整理

### 「ファイルを開く」の single source of truth

開いたファイルは `WorktreeView` の local state `previewSelection: PreviewSelection | null`
(`src/renderer/worktrees/WorktreeView.tsx:105`) だけが持つ。型は
`{ path, line?, scope? }` (`src/renderer/previewSelection.ts`)。タブの概念はなく、
開けるファイルは常に 1 つ。worktree ごとに WorktreeView instance が keep-alive で
残るので、選択は worktree 単位で独立している。

### ファイルを開く経路 (すべて同じ state に書き込む)

| 経路 | 起点 | 書き込む値 |
|---|---|---|
| Files ツリーの行クリック | `FilesPane.tsx:335` | `{ path }` |
| Changes のファイル行 | `ChangesPane.tsx:156` | `{ path, scope }` |
| Search (横断文字列検索) の結果行 | `SearchPane.tsx:235` | `{ path, line }` |
| ターミナルのファイルリンク | `WorktreeView.tsx:231` (`resolveRepoFile` で解決) | `{ path, line? }` |
| Cmd+P ファイル名検索パレット | `WorktreeView.tsx:421` | `{ path }` |

ターミナルリンクだけ特殊で、worktree 外のファイルを開いた場合は **絶対パス** が
`path` に入る (`src/main/files/files.ts:38` の `resolveRepoFile`)。
それ以外はすべて worktree からの相対パス。

### Files ツリー側の state

`FilesPane` (`src/renderer/files/FilesPane.tsx`) が持つ:

- `expandedDirectories: Set<string>` — 展開中ディレクトリ。local state。
- `filesCache` — ディレクトリ単位の lazy load 結果とロード中管理。
  展開したディレクトリだけ file watcher の対象になる (`syncFileWatchTargets`)。
- 既に `previewSelection?.path === row.node.path` で selected ハイライトは出る
  (`FilesPane.tsx:285`)。**行が画面に出ていれば、もうハイライトは機能している**。

Explorer のタブ (`Changes / Files / Search / Bookmarks`) は `ExplorerPanel` の
local state `activeTab` で、4 つとも `<Activity>` で keep-alive。
**hidden の間は effect が止まり、visible に戻ると再実行される**
(architecture.md の UI structure 参照)。

### つまり、足りないものは 3 つ

1. 選択ファイルの祖先ディレクトリの自動展開
2. 選択行へのスクロール
3. Files タブがアクティブでない時、そもそもツリーが見えていない

## 仕様の決定事項

### Q1. Files タブへ自動で切り替えるか → 切り替えない

ファイルを開いた時に Explorer のタブを Files に強制切替はしない。
Changes でレビュー中にファイルを開くたび Changes タブを奪われるのを避ける。
代わりに「Files タブを見た時は常に選択ファイルが見えている」ことを保証する
(Q3 の一貫ルール)。

### Q2. 展開は既存の展開状態にどう畳み込むか → union (追加のみ)

reveal による展開は `expandedDirectories` への追加のみで、既存の展開状態は
そのまま残す。collapse はユーザーの明示操作 (`Collapse all` や行クリック) だけで
起きる。自動で畳むことはしない。
(既存の `Changed dirs` ボタンは replace 型だが、別物としてそのまま残す。)

### Q3. いつ reveal (展開 + スクロール) を発動するか → 2 トリガに固定

トリガは次の 2 つだけ:

1. `previewSelection.path` が変わった時 (Files タブが見えていれば即座に)
2. Files タブが visible になった時 (hidden 中の変化に追いつく)

一つの宣言的ルールとして言い直すと:

> **Files タブが見えている間は、選択中ファイルがツリー上で (展開・スクロール済みで)
> 見えている。見えていない間は何もせず、次に見えた時点で追いつく。**

実装上は、この 2 トリガは `FilesPane` におく 1 つの effect で同時に実現できる
(Activity の hidden 中は effect が止まり、visible 復帰で再実行される性質を利用)。

手動操作との競合: reveal はイベント駆動にして、常時強制はしない。
ユーザーが選択ファイルの祖先を手動で collapse したら、その時点では
「見えていない」状態を許す (無限に展開し返してユーザーと戦わない)。
次の reveal トリガでまた追いつく。

スクロール位置は `block: "nearest"` (最小移動)。既に画面内なら動かない。

### Q4. worktree 外のファイル (絶対パス) はどうするか → 何もしない

ターミナルリンクからは worktree 外のファイルも開ける (絶対パスが入る)。
ツリーは worktree 内しか表示しないので、reveal はスキップする。
ハイライトも現状どおり出ない。エラーも出さない。

### Q5. 削除済み・存在しないファイルを開いている時 → 何もしない

選択中のファイルが削除された場合、`previewSelection` は残るが
ツリーの listing には出てこない。reveal は単に対象を見つけられずに終わる。
エラーは出さない。

### Q6. (副次) 同じファイルをもう一度開いた時 → 再 reveal しない

`previewSelection.path` が同じまま再クリック (ターミナルリンクの再クリック等) しても
再スクロールしない (単純な `path` 依存の effect では再発火しない)。
不満が出たら reveal 要求に連番を持たせる (state は ID + seq 程度で済む)。

## 実装の概形 (詳細設計の前提)

- `FilesPane` に `useEffect(() => { reveal(previewSelection?.path) }, [previewSelection?.path])`
  を足す。hidden 中は動かず、visible 復帰時に再実行されるので Q3 の両トリガを
  これ 1 つでカバーする。
- `reveal(path)`:
  1. 絶対パスなら return (Q4)
  2. 祖先ディレクトリを浅い順に `loadDirectory` (`revealChangedDirectories` と同じ手順)
  3. `expandedDirectories` に祖先を union で追加
  4. 行に `data-path` 属性を付け、`scrollIntoView({ block: "nearest" })` でスクロール
     (FileSearch の `data-file-search-index` と同じパターン。既に画面内なら動かない)
- スクロールは expand の commit 後の描画を待つ必要がある。
  「pending scroll 対象の path」を state に持ち、visible rows に対象が現れた時点で
  スクロールしてクリアする形が素直 (loadDirectory の非同期完了と描画の順序を
  気にしなくて済む)。
- visible 復帰時の再実行で、さっき reveal した同じファイルへ再度スクロールしないよう、
  最後に reveal した path を ref に覚えて同 path はスキップする (Q3 の手動 scroll away
  との共存)。hidden 中に別ファイルが開かれていれば path が違うので追いつく。

## 関連

- 既存の `Changed dirs` ボタンは replace 型の展開 (F8 とは別物として残る)
- F50「変更ファイルだけをツリー表示」と組み合わせる場合の話は今回のスコープ外
