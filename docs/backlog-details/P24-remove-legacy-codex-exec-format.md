# P24 Codex CLI 旧ログ形式の後方互換パーサを削除する

Last updated: 2026-08-11

`P24` は、Codex セッション検出 (`src/main/agents/codex/worktree-session-detection.ts`) に
残した CLI 0.147 未満向けの旧形式パーサを、いつ・どう確認して消すかのメモ。

## 経緯

Codex CLI 0.147 で、worktree 検出に使っていた2つのログ payload が構造を変えた。

- exec の cwd: `response_item` の `function_call`(`name: "exec_command"`, `arguments` が
  JSON 文字列で `workdir` を含む) → `event_msg` の `item_completed`、
  `item.type: "CommandExecution"`、`item.cwd` が `file://` URL
- 変更ファイル: `event_msg` の `patch_apply_end`、`changes` が path map →
  `event_msg` の `item_completed`、`item.type: "FileChange"`、`item.changes` が同じ path map

新形式に未対応だったため、新形式だけを使うセッションは worktree の証拠が一切取れず、
primary link を失うと Sessions にも Suggested にも出せず detach もできなくなっていた
(実例: `019fe60e-2fa7-7653-9a47-0e69431755ae`)。

新形式のパーサを追加したが、旧形式のパーサ (`parseCodexExecCommandEndCwd`,
`parseCodexFunctionCallWorkdir`, `parseCodexPatchApplyChanges`) は削除せず残した。

## なぜ即削除しなかったか

`~/.codex/sessions` を実データで確認したところ、削除を正当化できるだけの根拠がなかった。

- 新旧の混在は CLI バージョンで綺麗に切り替わっていない。0.145.0 / 0.146.0 では
  **同一セッションファイル内**で旧形式 (`function_call`/`exec_command`) と新形式
  (`custom_tool_call`/`exec`) の両方が出現していた(例: 2026-07-26 の rollout で
  旧55件・新97件)。モデル側の tool 選択に依存しており、CLI バージョンだけでは判定できない
- 旧形式の最終出現は 2026-07-31(2026-08-11 時点で11日前)で、リリースの新旧とは無関係に
  「起動したままの古い CLI プロセスが動き続ける限り出続ける」性質がある。Yuru の開発では
  古いセッションを開きっぱなしにしながら新しいセッションも開くため、新旧は長期間並存しうる
- 確認時点の 0.147.0 セッション(17件、2026-08-08〜08-10 の3日間)では旧形式は0件だったが、
  サンプルが薄く「0.147.0 では絶対に出ない」と断定はできない

## 削除条件

**2026-09-11 以降**に、下記の確認方法を再実行する。
そのとき見つかった `latest_old`(旧形式の最終出現日時)が、実行日から見て1ヶ月以上前
(2026-08-11 以降ずっと出現していない、という意味になる)であれば削除してよい。
2026-09-11 より前には確認しない。観測期間が1ヶ月に満たない状態で0件でも判定材料にしない。

## 確認方法

`~/.codex/sessions` 配下の全 `*.jsonl` を走査し、次のいずれかが出現する最終日時を調べる。

- `type: "response_item"`、`payload.type: "function_call"`、`payload.name: "exec_command"`
- `type: "event_msg"`、`payload.type: "patch_apply_end"`

```python
import json, glob

latest_old = None
for f in sorted(glob.glob('~/.codex/sessions/**/*.jsonl', recursive=True)):
    with open(f) as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            p = obj.get('payload', {})
            is_old = (
                (obj.get('type') == 'response_item' and p.get('type') == 'function_call'
                 and p.get('name') == 'exec_command')
                or (obj.get('type') == 'event_msg' and p.get('type') == 'patch_apply_end')
            )
            if is_old and (latest_old is None or f > latest_old):
                latest_old = f

print('latest session with legacy format:', latest_old)
```

`latest_old` の判定基準は上の「削除条件」を参照。

## 削除条件を満たしたら消すもの

`src/main/agents/codex/worktree-session-detection.ts`:
- `parseCodexExecCommandEndCwd` / `CodexExecCommandEndCwd`
- `parseCodexFunctionCallWorkdir` / `CodexFunctionCallWorkdir`
- `parseCodexPatchApplyChanges` / `CodexPatchApplyChanges`
- `detectCodexWorktreeSessionEntries` 内でこれら3つを呼んでいるループ

`test/main/worktree-session-detection.test.mjs`:
- `detectCodexWorktreeSession は exec_command_end.cwd を fallback hint として読み turn_context.cwd は無視する`
- `detectCodexWorktreeSessions は 0.130 の function_call.arguments.workdir を読む`
- `detectCodexWorktreeSessions は patch_apply_end.changes を読む`

新形式 (`parseCodexCommandExecutionCwd`, `parseCodexFileChangeChanges` とそのテスト) は残す。
