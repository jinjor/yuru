# Architecture Notes

Last updated: 2026-05-27

この文書は現在の Yuru のアーキテクチャをまとめる。
実装の細部、型定義、処理手順の正確な姿はコードを正とする。

## Core entities

- `repo`
  - Yuru が左ペインの主導線に表示する単位
  - task worktree 群の親になる
- `task worktree`
  - `repo` の main worktree を除いた Git worktree
  - Yuru の中心的な作業単位
  - `Files`, `Changes`, diff, preview の基準になる
  - 現在位置は `worktreePath` で表す
- `primary session`
  - task worktree に attach された session
  - 1 task worktree に最大 1 つだけ存在する
  - 1 provider session は同時に複数 task worktree の primary にはならない // これは緩めてもいいかも
- `suggested session`
  - Yuru 外で作られ、task worktree に紐づいていると推測される session
  - provider store から推測した weak candidate
  - 明示的な昇格操作までは primary として扱わない
- `terminal runtime`
  - Yuru が現在起動している PTY process
  - active / inactive 表示は terminal runtime の有無から導出する
  - terminal runtime 自体は永続化しない

## Source of truth

- Git
  - repo が実在する Git repository かどうか
  - worktree path
  - current branch / detached HEAD
  - status, diff, file content
- provider store
  - Claude / Codex の保存済み session
  - provider session id
  - last message や timestamp
  - worktree session detection 用の path hint
- Yuru metadata
  - どの repo を主導線に表示するか
  - repo と task worktree の path link
  - task worktree と primary session の strong link
- process memory
  - active terminal runtime
  - PTY process と scrollback
  - file watcher の購読状態

Yuru metadata は source of truth の複製ではない。
Git や provider store が持っている状態を丸ごとコピーせず、Yuru 自身が主導線を組み立てるために必要な最小限の情報だけを持つ。
branch、diff、provider session の本文、terminal runtime は metadata に保存しない。

metadata は通常 `~/.yuru/metadata.json` に置く。
テストや開発用に `YURU_METADATA_PATH` で保存先を差し替えられる。

最小 schema は次の形である。

```json
{
  "repos": [
    {
      "id": "uuid",
      "repoPath": "/path/to/repo"
    }
  ],
  "taskWorktrees": [
    {
      "repoId": "uuid",
      "worktreePath": "/path/to/worktree",
      "primarySession": {
        "provider": "codex",
        "providerSessionId": "..."
      }
    }
  ]
}
```

`primarySession` は必須ではない。
Git 上には存在するが、まだ Yuru metadata に strong link を持たない worktree もありうる。

## Repo assembly

左ペインの repo 一覧は、まず Yuru metadata の `repos` から組み立てる。
これにより、worktree が 0 件の repo でも Yuru 上で作業開始の起点にできる。

各 repo の task worktree 一覧は、その repo に対して Git から worktree 群を読んで組み立てる。
main worktree は task worktree として表示しない。
その上に Yuru metadata、provider store、active terminal runtime を重ねる。

- metadata の `primarySession` が有効なら、その session を task worktree の primary として表示する
- provider store の hint から worktree 配下の session を推測できる場合は suggested session として表示する
- active terminal runtime があれば active として表示する
- metadata にない Git worktree も、primary なしの task worktree として表示する

provider の path hint は candidate 推測にだけ使う。
task worktree と primary session の strong link は、作成または昇格の明示操作でだけ変わる。

worktree の外部 rename は自動追跡しない。
古い path の strong link は起動時 maintenance で削除され、新しい path は primary なしの Git worktree として再発見される。

## Provider sessions

対応 provider は Claude と Codex である。
provider ごとの session store や resume command の違いは adapter に閉じ込める。

worktree session の create / resume は、Claude / Codex とも cwd = repo root で起動する。
PTY 内で `cd` しても、`Files`, `Changes`, diff の作業ルートは runtime cwd ではなく選択中 task worktree の `worktreePath` で決まる。

新規 worktree session 作成時は、まず Git worktree を作り、その場で provider session を開始する。
provider session id が起動時に取れる場合はその場で primary に attach し、遅れて分かる provider は session id 解決後に attach する。
初回起動時だけ worktree context を hidden prompt として注入する。
この prompt は「provider session は repo root で起動しているが、実際の作業場所は task worktree である」ことを明示し、ファイル操作・コマンド実行・build/test は `worktreePath` で行うよう指示する。

- Claude: `--append-system-prompt`
- Codex: `-c developer_instructions=...`

resume 時には worktree context を再注入しない。
Codex は repo root から保存済み session を再開するため、resume command に `--all` を付ける。

worktree context prompt は `~/.yuru/worktree-context-prompt.txt` で差し替えられる。
ファイルがない場合は Yuru 組み込みの default template を使う。

## Operations

- `yuru add`
  - 現在の cwd から Git repo root を解決し、Yuru metadata に repo を登録する
  - すでに登録済みなら重複登録しない
- create worktree session
  - repo row から branch name と provider を選ぶ
  - branch name の `/` は worktree name では `-` に置き換える
  - worktree path は provider adapter が決める
    - Claude: `<repo>/.claude/worktrees/<worktreeName>`
    - Codex: `<repo>/.yuru/worktrees/<worktreeName>`
  - 既存 directory や既存 branch がある場合は作成しない
  - Git worktree 作成、provider 起動、primary attach を 1 つの作成フローとして扱う
- resume primary session
  - primary session がすでに active terminal runtime を持つ場合は、その terminal runtime を選択する
  - inactive の場合は provider store の session を確認してから resume する
  - provider store から消えている primary は detach する
- promote suggested session
  - suggested session を primary に昇格し、resume / select する
  - 同じ provider session が別 task worktree の primary だった場合は、元の strong link を外す
- remove worktree
  - 追跡中の session (primary / suggested) が active な worktree はメニュー段階で削除させない
  - 削除の直前に、その worktree を cwd にした生きたプロセスがないか OS に問い合わせる (lsof)
  - セッションを止めた後も worktree を使用中のプロセスがいれば、command と PID を一覧表示する。明示確認後は、表示時になかったプロセスを止めないよう再照合して全件へ SIGTERM を送り、終了を確認してから削除する
  - 通常は `git worktree remove`、dirty で拒否されたら明示確認のうえ `--force`
  - 削除が成功したら metadata の task worktree record も削除する。branch と provider session 履歴は残す
- startup maintenance
  - app 起動時に registered repo ごとに `git worktree list` を実行する
  - list に成功した repo だけ、metadata に残った stale task worktree record を削除する
  - repo 自体の cleanup はしない

## UI structure

左カラムは `repo > task worktree` を基本構造にする。
repo row は task worktree が 0 件でも表示し、新規 worktree session の起点になる。

task worktree row は branch、primary session の状態、provider、preview、suggested session の存在を表示する。
primary session が active なら選択し、inactive なら resume する。
primary がない task worktree では suggested session を表示し、ユーザー操作で primary に昇格できる。

右側の `Terminal`, `Files`, `Changes`, preview は選択中の task worktree に連動する。
どの terminal runtime を見ているかと、どの task worktree のファイルを見ているかがずれないように、UI の選択状態は `worktreeId` と `terminalRuntimeId` の組み合わせで持つ。

Terminal の描画には xterm.js を使う。
stable 6.0.0 には IME の変換位置がずれて過去に入力したテキストの断片が再送されるバグがあるため、修正済みの 6.1.0-beta 系(VS Code が本番で使っているのと同じ系列)を使っている。stable 6.0.0 系に戻すと再発する。6.1.0 stable が出たらそちらに移行する。

PTY の出力は main process 側でも headless の xterm.js (`TerminalScreen`) に通し、画面とスクロールバックの状態として保持する。
セッションを切り替えて戻ってきた時は、この状態を serialize addon で復元用シーケンスに変換して renderer の端末に書き込む (VS Code のターミナル復元と同じ方式)。
生の出力ストリームを溜めて再生する方式は、容量制限で先頭を切り落とした時にエスケープシーケンスや TUI の再描画フレームの途中から再生されて表示が壊れるため使わない。

## Appendix

2026-05-16 までアーキテクチャ刷新を行なっていたため、このドキュメントに沿わない古い実装が残っている可能性がある。
移行時の判断と checklist は [task-worktree-first ADR](adr/20260516-task-worktree-first-model.md) に残す。
