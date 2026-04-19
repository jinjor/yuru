# I12 Session Worktree Adopt

Last updated: 2026-04-20

`I12` は、session 開始後に worktree へ移動したケースを Yuru がどう扱うかを決めるためのメモ。
特に `Changes` や `Files` が参照する rooted path と、provider ごとの resume 条件のズレを整理する。

## Goal

- session 開始地点と実作業場所がズレたときも、Yuru の表示と実体験が食い違いにくくする
- provider を source of truth にする方針をできるだけ崩さない
- Yuru 独自の永続状態を増やすとしても、最小限の補助情報に留める

## Problem statement

- 今の Yuru は active session の `cwd` を session 開始時に固定で持ち、それを `Changes` / `Files` / branch 表示などの基準に使っている
- そのため repo root で session を始めてから provider に worktree 作成と移動を頼むと、実際の作業は worktree でも Yuru の rooted path は root に残る
- 最近は「先に worktree を切ってから session 開始」よりも、「session の中で worktree を切って移動する」運用が多い

## Provider findings

- Claude:
  root で始めた session を途中で worktree に移せる
- Claude:
  resume の lookup は元の root 側に強く紐づく一方、session 内の `cwd` や `worktree-state` には worktree 側の情報が残る
- Claude:
  そのため `resumeLookupCwd` と `effectiveCwd` を分ける余地がある
- Codex:
  `session_meta.cwd` は基本的に起動時の `cwd`
- Codex:
  一方で `turn_context.cwd` や `exec_command_end.cwd` には、その turn / command が実行された場所が残る
- Codex:
  `resume <id>` は呼び出し元の `cwd` で再開できるが、`--last` や picker は `cwd` フィルタ付きで、root で始めた session が worktree 側から自然に見えないことがある

## Main tension

- provider の durable な session root と、今ユーザーが実際に作業している場所は一致しないことがある
- このズレを Yuru が無視すると UI が嘘をつく
- 逆に Yuru が shell の一時的な移動に毎回自動追従すると、session の rooted path が不安定になる

## Non-goals

- provider の session model を Yuru 独自 ID や独自 project 情報で置き換えること
- `cd` のたびに rooted path を自動で追従させること
- 「worktree を切らずに session 開始する」運用を完全に禁止すること

## Possible directions

- worktree-first の導線を強める:
  `Task session` と `Quick session` のように、新規 session 導線で worktree 付き開始を推す
- provider 再読込ベースで扱う:
  Claude は provider 側の情報から `effectiveCwd` をかなり復元できそう
- observed path ベースで扱う:
  Codex は `latest exec_command_end.cwd`、なければ `latest turn_context.cwd` を `observedCwd` として扱う
- suggest only にする:
  `observedCwd` が既知の worktree 配下に入ったと確信できたときだけ `Adopt this worktree` を提案する
- Yuru 側で補助状態を持つ:
  provider から十分に復元できない場合だけ adopt 結果を最小限の補助情報として永続化する

## Current leaning

- false positive より false negative を優先して避ける
- まずは「worktree に入ったと確信できたときだけ suggest する」方針がよさそう
- Claude は `resumeLookupCwd` と `effectiveCwd` を分けて扱えるかを調べる価値が高い
- Codex は `session_meta.cwd` を lookup 用に維持しつつ、表示用には `observedCwd` を候補にするのが現実的
- Yuru 独自の durable state は、provider の記録だけでは復元できない場合の最後の手段にしたい

## Provisional rules

- `resumeLookupCwd`:
  provider の session を再開するための lookup 起点。provider が durable に持っている root を基本にする
- `effectiveCwd`:
  `Changes` / `Files` / branch 表示など、Yuru の UI が参照する rooted path
- `adopt`:
  session identity や provider の resume lookup は変えず、Yuru の `effectiveCwd` だけ切り替えること
- path normalization:
  観測した `cwd` が worktree 配下のサブディレクトリでも、UI に使う際は worktree root に正規化する
- suggest condition:
  `observedCwd` が current root と異なる既知 worktree 配下だと確信できたときだけ `Adopt this worktree` を提案する
- false negative:
  worktree に入っていても観測できない間は root のままを許容する
- false positive:
  一時的な調査や `cd` で rooted path が勝手に切り替わるのは避ける

## Provider-specific provisional rules

- Claude:
  `resumeLookupCwd` と `effectiveCwd` を分けて扱う前提で考える
- Claude:
  provider 側の `worktree-state` や session 内の `cwd` から `effectiveCwd` を復元できる可能性が高い
- Codex:
  初回読み込み時の `effectiveCwd` は `latest exec_command_end.cwd` を第一候補とする
- Codex:
  `latest exec_command_end.cwd` がなければ `latest turn_context.cwd` を使う
- Codex:
  それもなければ `session_meta.cwd` を使う
- Codex:
  初回読み込み時に root のままでも、その後 worktree 側の `cwd` を観測できたら後追いで adopt を suggest / 適用できるようにする

## Monitoring and suggest

- suggest は一回だけの通知イベントではなく、session の派生状態として扱う
- 具体的には `effectiveCwd` とは別に `suggestedWorktreePath | null` を持ち、食い違っている間だけ表示する
- `suggestedWorktreePath !== null` かつ `suggestedWorktreePath !== effectiveCwd` の間は、`Adopt this worktree` を出し続ける
- inactive session の初回読み込みでは、suggest を出すより先に `effectiveCwd` を自動で寄せる
- active session では、UI が勝手に切り替わる驚きを避けるため、自動 adopt ではなく suggest に留める

## Monitoring points

- 初回の `loadSessions()` 時に provider の保存情報から `effectiveCwd` と `suggestedWorktreePath` 候補を導出する
- active session 中は PTY の `onData` を activity のトリガとして使い、provider の保存情報を debounce 付きで再読込する
- PTY の生出力そのものを解釈して `cwd` を取るのではなく、provider 側の保存ログを source of truth として再計算する
- 必要なら active session にだけ遅い fallback poll を入れ、保存タイミングの取りこぼしを減らす
- `observedCwd` は毎回 worktree root に正規化してから `effectiveCwd` / `suggestedWorktreePath` を判定する

## Suggest UI

- suggest は session list ではなく、選択中 session の workspace 上部に出す
- 候補としては terminal header の直下か workspace 最上段の banner が自然
- 文面は「この session は worktree `...` で作業しているように見える」に近い補助的なトーンにする
- `Adopt` を押したら `effectiveCwd` を切り替え、食い違いがなくなるので banner は消える
- 必要なら `Dismiss` を後から足せるが、最初は「食い違っている間は出し続ける」だけでもよい

## Open questions

- `observedCwd` は `latest exec_command_end.cwd` を第一候補にして十分か
- worktree 配下のサブディレクトリで作業している場合、どのタイミングで worktree root に正規化するか
- `Adopt this worktree` は UI root の切替だけにするか、session resume 導線も一緒に調整するか
- `Task session` / `Quick session` のような入口変更を、この item と同時に考えるべきか

## Relation to architecture

- `docs/architecture.md` の方針どおり、provider の source of truth は provider 側に置きたい
- この item で Yuru 側の補助状態を認める場合も、provider session の複製ではなく UI の rooted path 補助に限定したい
