# I18 worktree 表示情報の更新タイミング

Last updated: 2026-05-24

## Purpose

左ペインと右ペインが同じ worktree 表示情報を見ているのに、更新タイミングが分散している。
PR、branch、diff、最新メッセージ preview の鮮度を揃えるため、backend 側で更新タイミングを管理し、frontend は必要な情報を購読する形に寄せたい。

## Current problem

現在の `sessions:stateChanged` は名前が広すぎる。
実態は active runtime や primary link の変化に近く、エージェントが返答した、preview が更新された、branch や PR が変わった、という意味ではない。

また、右側の session view は選択中 worktree について `getGitBranchContext` を定期的に呼ぶ一方、左側の repo list は `getRepos` が走った時だけ更新される。
このため、右ヘッダーの PR badge と左カードの PR badge / preview の鮮度がずれる。

## Refresh policy

更新頻度は「GitHub 側で変化が起きる確率」ではなく、「ユーザーがその情報を見る可能性」に合わせる。

- active session:
  - エージェントが返答したタイミングで即 refresh する。
  - その後は最後の返答からの経過時間に応じて interval を伸ばす。
  - これは失敗時 retry の backoff ではなく、セッションが放置されている可能性に応じて polling を弱めるための backoff である。
- inactive session:
  - 定期更新しない。
  - GitHub 側で PR が merge される可能性はあるが、ユーザーがその session を見ている可能性が低いため、常時追わない。
- app inactive / hidden:
  - session の状態に関わらず、全ての polling を止める。
  - app が戻った時に active session を必要に応じて refresh する。

選択中 session は active の中でも高頻度にしてよい可能性があるが、まずは考慮しない。
選択状態を組み込む場合でも、policy が複雑にならないよう matrix に追加する。

## Backoff shape

具体値は実測で調整する。
初期案:

```text
agent response completed
  -> refresh immediately
  -> 15s
  -> 30s
  -> 1m
  -> 2m
  -> 5m
  -> 10m
```

新しい agent response が来たら interval を先頭に戻す。
app inactive / hidden になったら timer を止める。

## Update matrix

| Target | Source of truth | Refresh trigger | Frontend subscribers | Notes |
|---|---|---|---|---|
| 最新メッセージ preview | provider store | agent response completed / active backoff refresh | 左ペイン task worktree card | P11 の根本対応。PTY 出力ではなく provider store の保存済み preview を読む方がよい |
| branch | Git | agent response completed / active backoff refresh / app active 復帰 | 左ペイン task worktree card、右ヘッダー | terminal で `git checkout` した場合も拾いたい。Git が source of truth |
| PR | GitHub (`gh`) | branch refresh と同じタイミング | 左ペイン task worktree card、右ヘッダー | branch から PR を引く。GitHub が見られない時の扱いは静かに unknown でよい |
| diff / git status | Git | agent response completed / active backoff refresh / file watcher | Changes pane、Files pane、diff preview | diff 本文を全 worktree 分保持しない。backend は invalidation や summary を配り、表示中 file の diff は必要時に読む |

## Backend shape

backend に worktree 表示情報の小さな store を置く。

- worktree ごとに `branch`, `githubPullRequest`, `latestMessagePreview`, `gitStatusSummary` のような表示用状態を持つ
- update scheduler が session state と app active 状態を見て refresh 対象を決める
- 値が変わったら `worktreeContextChanged` のような event を frontend に送る
- frontend は左ペイン、右ヘッダー、Changes / Diff など必要な場所で購読する

diff は例外として、重い本文を store に持たない。
表示中の diff は今まで通り IPC で取得し、backend event は「再取得すべきかもしれない」という signal として扱う。

## Events

既存の `sessions:stateChanged` は曖昧なので、この item の中で意味を分ける。

- `runtimeSessionsChanged`
  - active / inactive runtime が変わった
- `worktreeSessionsChanged`
  - primary / suggested session link が変わった
- `agentResponseCompleted`
  - provider store に保存される最新メッセージ preview を更新できるタイミング
- `worktreeContextChanged`
  - branch、PR、git status summary、latest message preview など表示用状態が変わった

最初から全イベントを実装する必要はない。
ただし `sessions:stateChanged` に新しい意味を足し続けるのは避ける。

## Open questions

- agent response completed をどう検出するか
  - provider store の timestamp / preview 更新を watcher で見るのが本命
  - PTY 出力の区切りだけで判断すると保存済み preview とずれる可能性がある
- active session の backoff 上限を何分にするか
- app active / hidden を main process と renderer のどちらで管理するか
  - backend scheduler に寄せるなら main process が BrowserWindow の focus / blur / hide / show を見て渡すのが自然
- inactive session の PR state を完全に更新しないことで困る場面があるか
  - PR merge 時の worktree 自動整理は F18 とも関係する
