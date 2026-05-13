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

## Initial context injection

step 22 で両 provider を cwd = repo root で起動するため、初回 create 時に「ここが worktree です」を agent に伝える手段が要る。両 provider に hidden な session-level 注入機構があることを実機検証で確認した。

**Claude**: `claude --append-system-prompt <prompt>`
- system prompt（`system` role）に追記される。default 能力は維持
- 会話履歴に visible message としては現れない
- 動作確認: 渡した invocation でだけ system prompt に反映される。session に永続化はされない（resume 時は再構成）

**Codex**: `codex -c developer_instructions=<prompt>`
- `developer` role の message として turn 1 の session log に注入される
- 会話履歴に visible な user message としては現れない
- 動作確認: create 時に渡すと developer message として永続。resume 時に渡しても turn_context のメタにのみ載り、新しい developer message としては再投入されず model にも届かない（behavior probe で確認）

**運用ルール（両 provider 共通）**

- **create 時のみ** 注入する。Resume 時は注入しない
- Claude も Codex に合わせて create-only に統一する（Claude も resume 時に渡せば一見効くが、毎回明示的に渡す挙動を避けて pattern を揃える）
- Claude resume 時は system prompt に worktree 情報が乗らないが、conversation history に前 turn の振る舞いが残るので、model は文脈から worktree を継続認識する

**注入 template の例**

```
This session was opened via Yuru with the initial task worktree '<name>' (branch <branch>) at <worktree-path>.
```

書き方の方針:
- **「初期の作業場所」だと分かる wording**（`initial` / `was opened with` 等）。session 開始時点の context であって永続拘束ではない
- 命令形（"Use this path"）や強い指示は入れない。data として提示し、ユーザ発話との整合は model に任せる
- template は `~/.yuru/` 以下の設定ファイルに切り出してユーザが差し替えられるようにする。default を Yuru が組み込みで提供し、設定ファイルが無ければそれを使う

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
