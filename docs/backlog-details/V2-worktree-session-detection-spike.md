# V2 Worktree Session Detection Spike

Date: 2026-04-26

## Result

Claude / Codex ともに、provider store から task worktree に属する session を検出できる見込みがある。

この spike では UI にはまだ接続せず、後続 story の suggested session 判定で使える最小の抽出ロジックだけを追加した。

実装: `src/main/worktree-session-detection.ts`
テスト: `test/main/worktree-session-detection.test.mjs`

## Claude

成立する。

- `~/.claude/projects/.../*.jsonl` に `type: "worktree-state"` の entry があり、`worktreeSession.worktreePath` を直接読める
- `worktree-state` がない場合でも、通常の user / assistant / attachment entry に `cwd` がある
- `cwd` が既知 Git worktree path の配下なら weak candidate として扱える

優先順:

1. `worktree-state.worktreeSession.worktreePath`
2. entry の `cwd` が既知 worktree 配下かどうか

## Codex

成立する。

- `~/.codex/sessions/.../*.jsonl` に `type: "session_meta"` の entry があり、`payload.id` と `payload.cwd` を読める
- command 実行結果は top-level `exec_command_end` ではなく、`type: "event_msg"` かつ `payload.type: "exec_command_end"` として保存される
- `event_msg.payload.cwd` が既知 Git worktree path の配下なら weak candidate として扱える
- `turn_context.cwd` は実行 root と混ざりやすいので candidate 判定には使わない

優先順:

1. `session_meta.payload.cwd`
2. `event_msg.payload.type === "exec_command_end"` の `payload.cwd`

## Notes

- path 判定は false positive を避けるため、単純な prefix match ではなく path boundary を見る
- 複数 worktree に一致しうる場合は、最も深い worktree path を採用する
- この段階では provider session を primary に昇格しない。昇格は後続 story の明示操作で扱う
