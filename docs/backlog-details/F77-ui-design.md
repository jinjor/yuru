# F77: ブックマークのステータス表示 UI 設計

Last updated: 2026-09-04

## この doc の範囲

Bookmarks タブの各行に出す GitHub issue / PR のステータスバッジの**見え方と配置**を決める。
何を取得し、どう届けるかは [F77-bookmark-status.md](F77-bookmark-status.md)（構造設計）が扱う。
そちらで決まった `BookmarkStatus` の中身（issue は open/closed、PR は open/draft/merged/closed と isApproved）を
所与として、それ以外の情報は増やさない。

モックアップ: [../mockups/F77-bookmark-status.html](../mockups/F77-bookmark-status.html)

## 決めたこと（要約）

| 論点 | 決定 |
| --- | --- |
| バッジの見た目 | 既存の `GitHubBadge` をそのまま使う。issue はアイコンだけ差し替える |
| 色 | 既存の 4 色から増やさない。closed issue は merged と同じ紫 |
| 置き場所 | 行の**2 行目の先頭**（URL の左）。バッジ専用の行は作らない |
| タイトル | **2 行まで折り返す**（今は 1 行で `…` 切り）。行の高さはそのぶん増えてよい |
| 行の間隔 | 縦パディングを **6px → 10px**。行の境がタイトルの折り返しに紛れないようにする |
| クリック | **しない**。行全体がすでに URL を開くボタンなので、バッジは表示だけ |
| ステータス未取得 | **何も出さない**。プレースホルダもスピナーも置かない |

## 1. バッジの見た目

### 色は「その仕事がどうなったか」を表す

既存の PR バッジが持っている 4 色に、issue を後から当てはめる。**新しい色は 1 つも足さない。**

| 色 | 意味 | 該当する状態 | 既存クラス |
| --- | --- | --- | --- |
| 緑 | まだ生きている | issue open / PR open（approved 含む） | `.open` |
| 灰 | まだ本番向けではない | PR draft | `.draft` |
| 紫 | 片付いた | PR merged / **issue closed** | `.merged` |
| 赤 | 打ち切られた | PR closed | `.closed` |

**closed issue を赤ではなく紫にするのが唯一の判断**。同じ "Closed" でも、issue の closed は
たいてい「直った・対応した」で、PR の closed は「取り込まないことにした」。意味が逆なので同じ色にはしない。
GitHub 本体も完了した issue を紫で描いているので、見た目の学習コストもない。

限界として、`BookmarkStatus` には closed の理由（completed か not planned か）が入っていないので、
「対応せず閉じた issue」も紫になる。理由を取りに行くほどの価値はないと判断した。

### アイコンは種別だけを表す（状態では変えない）

| 種別 | アイコン (lucide-react) |
| --- | --- |
| issue | `CircleDot` |
| PR | `GitPullRequest`（既存のまま） |

PR 側はいま 4 状態すべてで `GitPullRequest` を使っている。issue も同じルールに合わせて、
open / closed のどちらも `CircleDot` にする。**アイコン = 種別、色と語 = 状態**という
2 軸がきれいに分かれるので、`GitPullRequestClosed` や `GitMerge` に差し替える案は採らない
（差し替えると PR 側だけ状態がアイコンにも色にも語にも三重に出て、issue と非対称になる）。

サイズ・線幅は既存と同じ `size={11} strokeWidth={2}`、`aria-hidden` も既存どおり。

### ラベル

`gitHubBadgeLabel` を issue に拡張する。PR 側の文言は 1 文字も変えない。

| 対象 | ラベル |
| --- | --- |
| issue open | `Open #482` |
| issue closed | `Closed #367` |
| PR open (isApproved: false) | `Open #491` |
| PR open (isApproved: true) | `Approved #491` |
| PR draft | `Draft #503` |
| PR merged | `Merged #10218` |
| PR closed | `Closed #455` |

**approved は色を変えず、語だけ変える**（既存の挙動そのまま）。approved も「まだマージされていない
生きた PR」なので緑のままが正しく、専用色を足すと 5 色目になって色の意味が薄まる。
issue に approved 相当はない。

## 2. 行のレイアウト

タイトルは**2 行まで折り返し**、バッジは**2 行目の先頭**（URL の左）に置く。

```
┌─────────────────────────────────────────────┐
│ Support nested worktrees in the file tree   │  ← タイトル: 2 行まで
│ so that subdirectories stay collapsed     ×│
│ ⊙ Open #482  https://github.com/…/482       │  ← メタ行: バッジ + URL
└─────────────────────────────────────────────┘
```

行の縦パディングは 6px から **10px** に広げる。行の高さはタイトルが 1 行なら約 56px、2 行なら約 72px。

### なぜ 2 行目の先頭なのか

1. **タイトルが動かない。** バッジはブックマーク登録の数秒後に後から届く。タイトル行に置くと、
   届いた瞬間にタイトルが縮んで折り返し位置が変わり、一覧全体がちらつく。
   バッジがメタ行にいれば、タイトルはバッジの到着と無関係でいられる。
2. **状態を縦に追える。** 左端ぞろえなのでアイコンが縦一列に並ぶ。右端に置くとラベル幅が
   （`Open #7` 〜 `Merged #10218`）バラバラなぶんアイコンの位置もばらけて、色の列として読めない。
3. **削除ボタンと離れる。** バッジはタップできない表示物なのに、丸くて色がついている。
   行右端の × の真横に並べるとボタンの仲間に見える。

バッジは状態と番号を持つメタ情報で、URL と同じ性質のものなので、同じ行にいるのが素直でもある。
GitHub の issue / PR の URL は短いので、375px（Explorer パネルの既定幅）でバッジと並べても
URL は切れずに収まる。

### なぜタイトルを 2 行にするのか

行を高くしてよいなら、その高さは**タイトルに使うのが一番得**。issue / PR のタイトルは長く、
1 行 `…` 切りだと「何の件か」が読めないことがある。バッジ・URL・削除ボタンはどれも
横幅が足りているので、増やした高さの行き先はタイトルしかない。

2 行を超えるタイトルは従来どおり `…` で切る。tooltip は現状のまま URL（変えない）。

### 行の間隔 — 縦パディングを 10px にする

タイトルが折り返すようになると、**行の中の改行と、行と行の境目が同じに見える**。
いまの縦パディング 6px（行の間は上下合わせて 12px）では、2 行タイトルの行が続いたときに
どこで 1 件が終わるのか読み取れない。10px（行の間 20px）まで広げると、
タイトルの行送り（12px × 1.35 で行間 4px 強）との差が十分につき、境目が一目で分かる。

12px も試したが、375px の細いパネルでは間延びして 1 画面に入る件数が減るだけだった。

**横のパディングは 12px のまま**変えない。Changes / Files / Search の行
（`.file-tree-row` と `.code-search-match-row` がどちらも `padding: 0 12px`）と
左端がそろっていて、タブを切り替えても文字の開始位置が動かない。

区切り線（`border-top`）は引かない。余白だけで境が読めるうえ、線を引くと
ホバーの背景 (`.bookmark-row:hover`) と二重に「行」を主張して、細いパネルがうるさくなる。

### 却下した配置

- **バッジ専用の行を作る**（バッジ / タイトル / URL の 3 行）。
  バッジは左上にそろうが、**タイトルは 1 行のままで何も改善しない**。
  ピル 1 個のために 1 行使い、その右はずっと空。さらに、色つきのピルが行の頭に来ると
  そこが行の区切りに見えて、**どこで 1 件が終わるのか読めなくなる**（モックアップの案 B）。
- **タイトル行の右端に置く**（RepoList / ターミナルバーと同じ末尾配置）。
  あちらは 1 行しかない文脈で、バッジが行の右端メタとして自然に収まる。ブックマークは複数行あり、
  上の 3 点がそのまま不利に働く。**バッジそのものは 3 か所で完全に同一**なので、
  「見た目を揃えたい」という要求は配置ではなくコンポーネントの共有で満たしている。

### メタ行の高さはバッジの有無で変えない

バッジ（`font-size: 10px` + `padding: 2px 7px` + border）は約 18px、URL 単独の行は約 14px。
そのままだと**ステータスが届いた瞬間にメタ行が伸びて下の行がずれる**。
メタ行に `min-height: 18px` を敷いて、常にバッジぶんの高さを確保する。
（タイトルの折り返し数で行の高さが変わるのは構わない。それは中身の量に応じた変化で、
バッジの到着で後から変わるものではない。）

## 3. クリックしない

バッジは `<span>` のまま置く（`GitHubBadge` に `onClick` を渡さない）。

- 行全体がすでに同じ URL を開くボタン (`.bookmark-open`) になっている。バッジを押せるようにしても
  **できることが 1 つも増えない**。
- `.bookmark-open` は `<button>` なので、その中に `<button>` は置けない。押せるようにするには
  行の構造を作り替える必要があり、得るもののないコストになる。
- 既存 2 か所の使い分けとも一致する: ターミナルバーは押せる（ほかに開く手段がないから）、
  RepoList は押せない（カード自体がクリックを持っているから）。ブックマークは RepoList と同じ側。

`.github-badge.interactive` は付けない（ホバーで明るくならない）。行のホバーで
`.bookmark-row:hover` の背景がつくので、押せる範囲は行全体だと伝わる。

tooltip も付けない。行の `<button>` がすでに `title={bookmark.url}` を持っており、
バッジに同じ URL を重ねても内側が勝つだけで意味がない。issue の `BookmarkStatus` には
そもそも URL が入っていない。

## 4. ステータスがないときは何も出さない

バッジを出さず、メタ行は URL だけになる。**プレースホルダ・スケルトン・スピナー・グレーの `—` は置かない。**

「まだ来ていない」状態は次の 3 つで、見分けはつかないし、つける必要もない。

- GitHub の issue / PR ではないブックマーク（永続的にバッジなし）
- アプリ再起動直後、最初の tick が来るまで（数秒〜60 秒）
- `gh` が無い / 未認証（永続的にバッジなし、構造設計で「静かにバッジ無し」と決まっている）

ローディング表示を置くと、1 番目と 3 番目では**永久に回り続ける**ことになる。
数秒後に消えるプレースホルダも、一瞬エラーのように見えてから消えるだけで役に立たない。

タイトルが未解決（`title === url`）でバッジもない行は、いまと同じくタイトルだけの 1 行。
メタ行は「バッジがある」か「`title !== url`」のどちらかが成り立つときだけ描く。

## 5. 実装の当たり — 既存クラスとの関係

### `GitHubBadge` — 対象を種別つきで受け取る

いまは `GitHubPullRequest` を直接受けている。issue も描けるように、引数を
`BookmarkStatus` と同じ形（種別 + 番号 + 状態）に変える。

```tsx
// バッジが描ける対象。BookmarkStatus と同じ形。
export type GitHubBadgeTarget =
  | { kind: "issue"; number: number; state: "open" | "closed" }
  | { kind: "pr"; number: number; state: "open" | "draft" | "merged" | "closed"; isApproved: boolean };
```

- クラスは `github-badge ${target.kind} ${target.state}` にする（`.pr` / `.issue` が増える）。
  `.issue.closed` だけを紫に上書きするのに使う。
- アイコンは `target.kind` で分岐。`gitHubBadgeLabel` は `target.kind` で分岐し、
  PR 側の case は現状のまま。
- tooltip 用の URL は任意の prop にする。渡すのはターミナルバーと RepoList だけ。
- 既存の 2 か所は `GitHubPullRequest` を `{ kind: "pr", number: github.prNumber, ... }` に
  詰め替えて渡す（`prNumber` → `number` の読み替えだけ）。1 行ずつの変更で済む。

### CSS (`src/renderer/style.css`)

`.github-badge` 本体・`.open` / `.draft` / `.merged` / `.closed` は**触らない**。

```css
/* .github-badge.merged のセレクタに並記する */
.github-badge.merged,
.github-badge.issue.closed {
  color: #bfc5ff;
  background: rgba(70, 78, 150, 0.22);
  border-color: rgba(144, 155, 255, 0.24);
}
```

Bookmarks pane 側は、いま `.bookmark-title` と `.bookmark-url` が共有している
`white-space: nowrap` / `text-overflow: ellipsis` を分離する。タイトルは折り返す側、
URL は折り返さない側になる。

```css
/* 折り返さないのは URL だけになる */
.bookmark-url {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-subtle);
  font-size: 11px;
}

/* タイトルは 2 行まで折り返して、超えたぶんを切る */
.bookmark-title {
  width: 100%;
  font-size: 12px;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

/* 行の縦の間隔を広げる。横は他ペインの行とそろえて 12px のまま */
.bookmark-open {
  flex: 1;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
}

/* バッジ + URL のメタ行 */
.bookmark-meta {
  width: 100%;
  min-height: 18px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.bookmark-meta .github-badge {
  flex-shrink: 0;
}

.bookmark-meta .bookmark-url {
  min-width: 0;
  flex: 0 1 auto;
}
```

`-webkit-line-clamp` は Chromium（= Electron）の標準機能で、`display: -webkit-box` と
`-webkit-box-orient: vertical` の 3 点セットで使う。

`.bookmark-meta .github-badge { flex-shrink: 0 }` は、既存の
`.task-worktree-heading .github-badge { flex-shrink: 0 }` と同じ意図（バッジは縮まず URL 側が縮む）。

### `BookmarksPane.tsx`

メタ行をいまの `<span className="bookmark-url">` 単体から `.bookmark-meta` で包む形に変える。
中身は「バッジがあれば出す / URL がタイトルと違えば出す」の 2 つ。

```tsx
{(bookmark.status || bookmark.title !== bookmark.url) && (
  <span className="bookmark-meta">
    {bookmark.status && <GitHubBadge target={bookmark.status} />}
    {bookmark.title !== bookmark.url && (
      <span className="bookmark-url">{bookmark.url}</span>
    )}
  </span>
)}
```

行の `onClick`・`title`・削除ボタンは一切変えない。

## 構造側との境界

- この doc は `bookmark.status` が `BookmarkStatus | undefined` で renderer に届くことだけを前提にする。
  取得のタイミング・キャッシュ・push 経路は構造設計側の話で、UI からの要求はない。
- ただし 1 点だけ依存がある: **ステータスと同じ tick でタイトルも最新化される**こと。
  タイトルが URL のままだとメタ行が URL 単体になり、バッジと重複した番号が並ぶ。
  構造設計で「GitHub ブックマークの title は GitHub が正」と決まっているので、この前提は満たされている。
- `GitHubBadgeTarget` と `BookmarkStatus` は同じ形にしてあるが、shared 側の型をそのまま
  renderer が import するか、renderer に別途置くかは構造側の判断でよい。
