# F1 Session Activity State

`F1` は、並列実行している active session が「作業中」なのか「人間の入力待ち」なのかを左ペインで区別して表示する機能。

これはトースト通知ではない。
目的は、開いていない session の状態を左ペインの provider dot だけで把握できるようにすること。

## Target state model

既存の `active / inactive` は PTY の有無を表す。
ここに agent の turn 状態を混ぜず、active session にだけ作業中/応答待ちを重ねる。

```text
inactive
  PTY がない
  dot: 消灯

active + working
  PTY があり、agent が作業中
  dot: 点滅

active + waiting
  PTY があり、人間の入力待ち
  dot: 点灯
```

作業中/応答待ちは `Yuru metadata` には保存しない。
RepoList を作る時に、現在 active な PTY runtime と provider の保存ログから表示状態へ写像する。

## Spike findings

### Codex

Codex の session JSONL には turn の開始/完了が明示的に残る。

- `event_msg` / `payload.type = "task_started"`
- `event_msg` / `payload.type = "task_complete"`

active runtime の provider session file を読めるなら、最後の `task_started` が最後の `task_complete` より新しい間は作業中、それ以外は応答待ちと判定できる。

Codex は session id 解決が遅れることがある。
session id がまだない間は provider store を読めない。
この状態は「新規起動中の active agent runtime」として `working` に写像する。

### Claude

Claude の session JSONL には Codex のような `task_complete` はない。
ただし turn 完了時に `system` 行が残る。

- `type = "system"`
- `subtype = "turn_duration"`

調査した session では、assistant の最終 text の直後に `turn_duration` が出ている。
途中の tool 実行は `assistant tool_use` と `user tool_result` として残り、その後も同じ turn が続く。

active runtime の provider session file を読めるなら、最後の human prompt / tool result / assistant tool use より新しい `turn_duration` があれば応答待ちと判定できる。
逆に、それらの turn 進行イベントが最後の `turn_duration` より新しければ作業中と判定できる。

`away_summary` は待機後に追加される meta 情報なので、turn 完了判定には使わない。

## Design direction

実装では、PTY runtime の状態と agent turn 状態を分ける。

- `WorktreeSessionState`
  - 既存通り `active | inactive`
  - PTY の有無だけを表す
- session の追加状態
  - active session: `working | waiting`
  - inactive session: `activityState` は表示に使わない
  - active PTY runtime と provider session file から導出する

作業中/応答待ちへの変換は、PTY 入力イベントではなく、その時点の runtime と provider log の状態から行う。

既存の `TerminalRuntimeRefreshScheduler` は PTY 出力の settled 後に worktree 表示を更新している。
作業中/応答待ちはこの settled 後の通知をきっかけに RepoList を再取得し、その時点の状態から再計算する。
PTY 入力イベントは turn 状態の source of truth にしない。
ただし Enter / Esc / Ctrl-C は provider log を読み直すきっかけにはする。

## Open design points

- 起動直後、まだ一度も prompt を送っていない active session は応答待ちとして表示する。
- Codex の session id 未解決中は provider store を読めないため、新規起動中の `working` として扱う。
- Claude の `turn_duration` が API error や permission prompt の時にも期待通り出るかは、実装前に小さな fixture か実機操作で追加確認する。
- UI は provider dot の点灯/点滅で表す。トースト通知や通知センターはこの item には含めない。

## Acceptance

- active な primary session が作業中の間、左ペインの provider dot が点滅する。
- active な primary session が人間の入力待ちの間、左ペインの provider dot が点灯する。
- inactive な primary session は従来通り消灯する。
- suggested session も active runtime がある場合は同じ状態を表示できる。
- state は app restart 後に永続化されない。再起動後は provider store と active runtime から再導出する。
