# V2 Worktree Session Detection Spike

Date: 2026-04-26 (revised 2026-05-13)

## Approach

Provider store の log を直近期間に絞って `ripgrep` で worktree 言及を grep し、マッチ行を parse する。Claude / Codex とも同じ方針。

実装: `src/main/worktree-session-detection.ts`

## Hints

### Claude

採用:
- 強: message entry の `cwd` が worktree 配下（全 user / assistant / attachment entry に乗っている）
- 弱: tool_use（Edit / Write / Read 等）の絶対 `file_path` が worktree 配下（false positive が出やすいので rank を下げる）

採用しない:
- `worktree-state` entry — Yuru は `--worktree` を使わない方針（step 22）。外部 `--worktree` session も `cwd` で拾える
- `gitBranch` — worktree 内で branch は事後に変わるため、一致は証拠にならず不一致は反証にもならない

### Codex

採用:
- 強: `session_meta.payload.cwd`
- 強: `event_msg.payload.type === "exec_command_end"` の `payload.cwd`

採用しない:
- `turn_context.cwd` — 実行 root と混ざりやすい

## Storage layout

**Claude**: `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`
- dir 名は元 cwd を encode したもの（`/` → `-`）
- 非可逆 encoding なので **既知 worktree path を同じルールで文字列化して dir 名と forward match する**。dir 名 → path の逆引きはしない

**Codex**: `~/.codex/sessions/YYYY/MM/DD/<sessionId>.jsonl`
- dir 階層に日付が入る

## 性能設計

検出を 2 段階で絞り込む:

1. **期間絞り（直近 30 日）**
   - Codex: dir 名から日付を計算して 30 日分の path を生成
   - Claude: `find <root> -mtime -30 -name '*.jsonl'`
2. **content prefilter**
   - `ripgrep` で worktree path / 名前を grep し、マッチ行 + session 開始メタだけを parse する（全 entry parse はしない）
   - rg 無し環境は文字列 includes でフォールバック

## False positive guards

- path 判定は prefix match ではなく path boundary（worktree path の dir 境界）で行う
- 複数 worktree に一致する場合は最も深い worktree path を採用
- session 内に複数 worktree への言及があれば、最も多く / 深く言及された worktree を選ぶ
