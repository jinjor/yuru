# F77 Bookmark Status

`F77` の設計メモ。叩き台。

## 要件

- ブックマークが GitHub の Issue / PR なら、一覧でステータス（open / closed / merged / draft / approved）を表示する
- ブックマークが大量にあっても大丈夫な取得方式にする
- UI の見た目は別途 yuru session で Claude Opus にデザインしてもらう。ここではデータと振る舞いの契約だけ決める
- （ブックマーク名の手動リネームは F77 ではやらない。別途 backlog に追加される予定。ただし後から自然に足せる設計にしておく — 「将来のリネーム」を参照）

## 前提（現状の実装）

- ブックマークは `~/.yuru/bookmarks.json` に worktreePath キーで永続化。`Bookmark = { url, title }` のみ。追加順固定
- GitHub の issue / PR URL の判定は `extractGitHubIssueOrPr` (`src/main/bookmarks/title.ts`) が既にある。owner / repo / number を URL から取れるので、Yuru の管理下にないリポジトリのブックマークでもローカルの git 情報なしに解決できる
- GitHub への定期ポーリングの先例は `PullRequestMonitor` (`src/main/github/pull-request-monitor.ts`):
  - **Yuru のウィンドウ**（Electron の BrowserWindow）の focus / blur で start / stop。非フォーカス中はポーリングしない
  - tick ごとに repo 単位で GraphQL を 1 クエリ発行（branch ごとの PR をエイリアスで束ね、120 エイリアスでも cost 1 を実測済み）
  - 取得結果は main のメモリに保持し、前回 push 値と比較して変わった分だけ renderer へ push する
  - `gh` の存在・認証は 5 分 TTL でキャッシュ済み (`src/main/github/github.ts`)
  - 旧実装は「生きた terminal runtime がある repo は 10 秒、それ以外は 60 秒」と repo の active/inactive で間隔を分けていたが、F77 の設計議論でこの区別は廃止する結論になった（後述）。`hasAliveTerminalRuntimeInRepo` はこの振り分け専用の関数なので、廃止と同時に消す
- PR の状態バッジは `GitHubBadge` (`src/renderer/pull-requests/GitHubBadge.tsx`) という共通コンポーネントで、repo 一覧とターミナルバーで共有済み
- F74 / F75 / F76 は main にマージ済み（2026-09-05）。ここで重要な仕様が 1 つ増えた: **F76 で `#NNNN` をクリックして登録されるブックマークは、実際が issue でも `/pull/NNNN` の URL になる**（GitHub が issue の番号なら `/issues/NNNN` へリダイレクトする仕様を利用。`src/renderer/terminal/terminalLinks.ts`）。GitHub は issue と PR で番号の名前空間が 1 つ（同じ repo に issue #5 と PR #5 は共存しない）なので、このリダイレクトが成り立つ。**URL のパス種別（issues / pull）から issue か PR かを判定してはいけない**
- GraphQL の実測（2026-09-06、いずれも `gh api graphql` で確認）:
  - `issueOrPullRequest(number:)` が存在し、Issue / PR を `__typename` で見分けられる。50 エイリアスを束ねても cost 1
  - `repository(owner:, name:)` をエイリアスで複数立てて repo を跨いだ 1 クエリにできる。2 repo × 20 エイリアスでも cost 1
  - 1 つの repo が解決不能（NOT_FOUND）でも他の alias は影響なく全件解決される（allSettled 的。失敗した alias だけ `null` + `errors` に path 付きで記録）。ただし errors があると `gh` は exit 1 で終わる。stdout には partial data が全部入っている

## 設計案

### 状態は main のメモリに持ち、bookmarks.json には書かない

ステータスは GitHub から導出できる揮発データなので、永続化すると single source of truth が崩れる（古い値をいつまで表示するか、の問題が生える）。`PullRequestMonitor` の `lastKnownPullRequestsByRepoPath` と同じく、main のメモリキャッシュに持ち、アプリ再起動後は最初の tick までバッジ無しで表示する。

（却下案: status を bookmarks.json に `fetchedAt` 付きで保存し、再起動後も前回値を表示する。復帰直後の表示は速いが、stale な値の扱いと書き込み頻度の割に得るものが少ない）

### ポーリング構造: 1 つのモニタ + 2 つのソース

F74 で「ターミナルの PR 表示のクリック = ブックマーク登録」になるため、同じ PR が worktree の PR バッジとブックマークの両方に出る。取得が 2 系統だと同じ PR を二重にポーリングして無駄な上、更新タイミングのズレで表示が食い違う。

かといって `PullRequestMonitor` にブックマークの処理を直接足すと、「GitHub をポーリングする仕組み」と「worktree の PR バッジ」「ブックマークのステータス」という 3 つの関心事が 1 クラスに混ざって汚くなる。そこで **ポーリングの仕組み（いつ・どう取るか）と、各機能（何を取り・どこに届けるか）を分ける**:

- **`GitHubStatusMonitor`（仮名）**: ポーリングの仕組みだけを持つ。tick 管理、focus / blur 連動、**全 source の対象を全 repo 跨ぎで 1 クエリに束ねて発行**（`repository(owner:, name:)` を repo ごとにエイリアスで立て、その中に branch / 番号のエイリアスを入れる入れ子構造）、レスポンスの仕分け。「worktree」「ブックマーク」のことは知らない
- **ソース**が 2 つ。それぞれ「この slug で欲しい対象のエイリアス集合を返す」「自分の分のレスポンスを解釈してキャッシュ更新と push を行う」という 2 つの関数だけをモニタに渡す:
  - **worktree PR ソース**: repo → worktree → branch を集め、「この branch の最新 PR」を要求する `pullRequests(headRefName:)` エイリアスを返す。結果は既存の可視性ルール（`toVisiblePullRequest`、headSha との照合）に通して、変化分を `pullRequestsChanged` で push。現行 `PullRequestMonitor` の機能面のロジックがそのままここに移る
  - **bookmark ソース**: 全 worktree のブックマークから GitHub issue / PR URL を集め、「この number の issue / PR」を要求するエイリアスを返す。**URL パスでは kind を判定できない**（上記の `/pull/NNNN` 問題）ため、`issueOrPullRequest(number:)` を使い、inline fragment で Issue / PullRequest 両方のフィールドを取って `__typename` で種別を確定する（このフィールドの存在は実機で確認済み: `gh api graphql` で cli/cli の issue が `__typename: "Issue"` で返ることを検証した）。結果はブックマーク用のメモリキャッシュに入れ、変化があった worktree へ `bookmarksChanged` を push。title 最新化（後述）の bookmarks.json 更新もここ

モニタは全ソースのエイリアスを repo ごとの `repository` エイリアスに振り分け、それらを 1 クエリに連結して発行する。将来 GitHub 由来の表示が増えても、ソースを足すだけでモニタは触らない。

### 取得の失敗と partial data（1 クエリ化に伴う決定）

全 repo を 1 クエリに束ねると、どれか 1 つの repo が解決不能（削除・権限変更など）でも他の repo は正常に取れるが、`gh api graphql` は `errors` が 1 件でもあると **exit 1 で終わる**（stdout には partial data が全部入っている。実測済み）。

そこで fetch 層の失敗判定をこう変える:

- exit code に関わらず stdout を JSON としてパースする。`data` が取れれば **partial 成功**とみなし、alias が `null` の repo だけ「今回は取得失敗」（前回値維持）として扱う。`errors` は警告として記録する
- `data` 自体が取れない（認証切れ・ネットワーク断などクエリ全体の失敗）ときだけ、全体を失敗として前回値維持する

「非ゼロ終了でも中身を見る」は気持ち悪い挙動なので、この分岐は fetch 層（`github.ts`）に閉じ込め、gh が errors で exit 1 になる仕様であることをコメントに書く。呼び出し側からは「repo ごとに結果か null が返る」だけに見えるようにする。

### 重複の扱い

- 同じ URL が複数 worktree でブックマークされていても、エイリアスは 1 本にまとめ、結果は参照する全 worktree に配る
- 同じ PR が branch 由来と bookmark 由来の両方に出る場合、クエリ構築時点では branch → number の対応が分からないためエイリアスは 2 本立つ。ただし同じクエリ内で、同じレスポンスから取るので、追加コストはほぼなく表示が食い違うこともない
- Yuru 管理下の repo は `getGitHubRepoSlug`、ブックマークにしか登場しない repo（例: cli/cli の issue をブックマークした場合）は URL から slug を取るので、ローカルに repo がなくても取れる。slug は大小文字を揃えて（小文字化して）から束ねる

### タイミングと動作条件

- **フォーカス中は全 repo 一律 10 秒**。旧実装の「生きた terminal runtime がある repo は 10 秒、それ以外は 60 秒」という区別は廃止する。GitHub 側の状態はローカルの作業有無と無関係に変わるので、repo の active/inactive で鮮度を変える根拠がない。コストも 1 クエリ = 1 ポイント（10 秒 tick で 360 ポイント/時間）にしかならない。ローカルの git コスト（tick ごとの `git worktree list`）は read-only でロックも絡まず、10 秒間隔でも誤差の範囲
- **Yuru のウィンドウ**の focus / blur に連動（`src/main/index.ts` の `browser-window-focus` / `blur`）。非フォーカス中はポーリングしない
- ブックマークタブが隠れている間もポーリングは続ける。クエリは 1 本に束なっているのでタブの可視性で節約できるコストがなく、開いた時に即座にステータスが出ている方がよい。可視性を main に通知する仕組みは新設しない
- ブックマーク追加直後は、次の tick を待たずに即時取得する（追加分の対象だけ tick を即時起動する）。初回から GraphQL に統一し、title 解決用の REST（`resolveUrlTitle` の `gh api repos/...`）とは分ける
- gh が使えない・認証がない場合は静かにバッジ無し（既存と同じ扱い）

### 取得するフィールドと型

PR の `isApproved`（reviewDecision）も表示する。既存の PR バッジと同じ情報量に揃える:

```ts
// shared/session.ts の GitHubPullRequest と同じ shape を PR には使う
type BookmarkStatus =
  | { kind: "issue"; number: number; state: "open" | "closed" }
  | { kind: "pr"; number: number; state: "open" | "draft" | "merged" | "closed"; isApproved: boolean };

interface Bookmark {
  url: string;
  title: string;
  status?: BookmarkStatus; // main のメモリキャッシュ由来。永続化しない
}
```

表示は `GitHubBadge` を流用する。issue 用のバリアント（アイコンと色）を足す形にすると、repo 一覧・ターミナルバー・ブックマークで見た目が揃う。バッジのクリックで URL を開くかどうかは Opus へのデザイン依頼に含める。

### renderer への渡し方

`getBookmarks` の応答に main がキャッシュをマージして返す。renderer の `BookmarksPane` は既に `onBookmarksChanged` で load し直しているので、ステータス更新もそのまま同じ経路で届く。新しい IPC channel は増やさない。renderer 側の変更はバッジ描画だけ。

### GitHub ブックマークの title はポーリングで最新化する（決定）

GraphQL に `title` を含め、保存済み title と違えば bookmarks.json を更新して push する。issue / PR のリネームに追従できる。これにより「GitHub ブックマークの title は GitHub が正」という一貫したルールになる。F71 の「title 解決失敗の再解決はしない」は汎用 fetch の話であり、GitHub はどうせポーリングするので矛盾しない。

### 将来のリネーム（F77 では実装しない）

手動リネームは別 backlog 項目として後でやる。今回の設計との接続:

- store 層には `updateBookmarkTitle`（bookmarks.json への書き込み）が既にあるので、実装時はそれを呼ぶ薄い IPC ハンドラを足すだけでよい。IPC 名も `updateBookmarkTitle` に揃える
- 「GitHub ブックマークの title は GitHub が正」のルールにより、リネーム対象は GitHub の issue / PR 以外のブックマークに限定される。`extractGitHubIssueOrPr` に合致する URL を main 側で拒否すればよい
- title 最新化と競合しないのは、このルールで title の所有者が一意に決まるから（GitHub か、ユーザーか）

### パフォーマンス

- **1 tick = 1 クエリ**。repo 数にもブックマーク数にもよらない（実測: 50 エイリアスでも cost 1、2 repo × 20 エイリアスでも cost 1）。rate limit（5000 ポイント/時間）に対して 10 秒 tick で 360 ポイント/時間
- ローカルのコストは tick ごとの `git worktree list`（repo あたり 2 プロセス）と `bookmarks.json` の読み込み。read-only でロックに絡まず、10 秒間隔でも負荷は誤差の範囲
- 1 クエリのエイリアスが異常に多い場合（数百）は分割する。実測から現実的には当分不要
- 非フォーカス中はポーリングごと止まるので、裏で動き続けるコストはない
- 変化がなければ push も renderer の再描画も起きない

### GitHub 以外への拡張

抽象化は作らない。URL → ステータス取得対象 の判定（`extractGitHubIssueOrPr`）と、クエリ構築 + キャッシュ（bookmark ソース内）を 1 箇所に閉じ込めておけば、将来 GitLab 等を足すときは別ソースを追加する形になる。YAGNI に従い、インターフェースの一般化はその時にやる。

## 作るもの

- `src/main/github/github-status-monitor.ts`（仮名）: tick 管理（一律 10 秒）・focus 連動・全 repo 跨ぎの 1 クエリ化・レスポンス仕分け。現行 `PullRequestMonitor` をこの構造に作り替える
- `src/main/github/github.ts`: クエリ組み立て（repo エイリアスの入れ子構造）と、partial data を許容するパース（exit 1 でも stdout を読む分岐はここに閉じ込める）
- worktree PR ソース: 現行 `PullRequestMonitor` から機能ロジック（branch 収集、可視性ルール、差分 push）を移す
- `src/main/bookmarks/status.ts`（bookmark ソース）: URL からの owner / repo / number 抽出（kind はレスポンスの `__typename` で確定する）、ブックマーク分のエイリアス構築、レスポンスのパース、メモリキャッシュ。`github.ts` の `buildGitHubPullRequestQuery` 系と同じノリで純粋関数にしてテスト可能にする。`listWorktrees` は main worktree（repo 直下）を返さないので、repo 直下のブックマーク分は自分で補う
- `src/main/service.ts`: `getBookmarks` でキャッシュをマージ、追加時の即時取得のトリガ。`hasAliveTerminalRuntimeInRepo` はポーリングからの参照がなくなるので削除する
- `src/shared/ipc.ts` / `src/shared/session.ts`: `BookmarkStatus` 型の追加
- `src/renderer/pull-requests/GitHubBadge.tsx`: issue バリアントの追加
- `src/renderer/bookmarks/BookmarksPane.tsx`: バッジ描画（デザインは別セッション）

## 未決事項

- （現時点ではなし。UI の見た目は Opus へのデザイン依頼で詰める）
