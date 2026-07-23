# Architecture Notes

Last updated: 2026-07-19

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
task worktree は Git の管理ディレクトリの作成日時が古い順に表示する。
その上に Yuru metadata、provider store、active terminal runtime を重ねる。

- metadata の `primarySession` が有効なら、その session を task worktree の primary として表示する
- provider store の hint から worktree 配下の session を推測できる場合は suggested session として表示する
- active terminal runtime があれば active として表示する
- metadata にない Git worktree も、primary なしの task worktree として表示する

provider の path hint は candidate 推測にだけ使う。
task worktree と primary session の strong link は、作成・昇格・解除 (detach) の明示操作でだけ変わる。

worktree の外部 rename は自動追跡しない。
古い path の strong link は起動時 maintenance で削除され、新しい path は primary なしの Git worktree として再発見される。

## Provider sessions

対応 provider は Claude と Codex である。
provider ごとの session store や resume command の違いは adapter に閉じ込める。

worktree session の create / resume は、Claude / Codex とも cwd = repo root で起動する。
PTY 内で `cd` しても、`Files`, `Changes`, diff の作業ルートは runtime cwd ではなく選択中 task worktree の `worktreePath` で決まる。

worktree の作成と provider session の開始は別の操作である (F43)。
session が紐づいていない task worktree に対して新規 session を開始すると、
provider session id が起動時に取れる場合はその場で primary に attach し、遅れて分かる provider は session id 解決後に attach する。
初回起動時だけ worktree context を hidden prompt として注入する。
この prompt は「provider session は repo root で起動しているが、実際の作業場所は task worktree である」ことを明示し、ファイル操作・コマンド実行・build/test は `worktreePath` で行い、回答中のファイルパスは `worktreePath` 基準の相対パスまたは絶対パスで記述するよう指示する。

- Claude: `--append-system-prompt`
- Codex: `-c developer_instructions=...`

resume 時には worktree context を再注入しない。
Codex は repo root から保存済み session を再開するため、resume command に `--all` を付ける。

worktree context prompt は `~/.yuru/worktree-context-prompt.txt` で差し替えられる。
ファイルがない場合は Yuru 組み込みの default template を使う。

## Operations

- `yuru add <directory>`
  - 指定した directory から Git repo root を解決し、Yuru metadata に repo を登録する
  - すでに登録済みなら重複登録しない
- create task worktree
  - repo row の `+` から branch name だけを入力する。provider は選ばない
  - 作成方法は 2 つあり、モーダルのタブで選ぶ (F42)
    - New branch: HEAD から新しい branch を切る
    - From origin: origin の branch を fetch して同名の local branch で取り込み、
      upstream を `origin/<branch>` にする。PR の head branch 名を貼り付けて、
      その PR を task worktree として開く用途
  - branch name の `/` は worktree name では `-` に置き換える
  - worktree path は provider によらず `<repo>/.yuru/worktrees/<worktreeName>` (Yuru が決める)
  - 既存 directory や既存 branch がある場合は作成しない
  - session は開始せず、作成した worktree を選択した状態にする
  - 過去に provider 別の配置 (`.claude/worktrees` / `.yuru/worktrees`) で作られた worktree は
    移行せず、そのまま Git worktree として扱う
- start session for worktree
  - session が紐づいていない task worktree を選択すると、Terminal に
    既存 session (suggested) と新規 session (Claude / Codex) の選択肢が出る
  - 新規作成した worktree も既存の Git worktree も、この同じ flow で session を開始する
  - session の起動に失敗しても worktree は削除しない
- resume primary session
  - primary session がすでに active terminal runtime を持つ場合は、その terminal runtime を選択する
  - inactive の場合は provider store の session を確認してから resume する
  - provider store から消えている primary は detach する
- promote suggested session
  - suggested session を primary に昇格し、resume / select する
  - 同じ provider session が別 task worktree の primary だった場合は、元の strong link を外す
- detach primary session
  - inactive な primary session の strong link だけを外す。worktree・Git の変更・provider store の session 履歴は消さない
  - active な terminal runtime を持つ間は detach できない。先に terminal 内でセッションを終了する
  - 外した session は provider store の path hint があれば suggested として再発見される
- remove worktree
  - 確認ダイアログ内の準備と、その後のバックグラウンド削除を分ける
  - 準備の最初に dirty を確認し、dirty ならセッションを止める前に force remove の明示確認へ切り替える
  - 削除が承認されたら、Yuru が起動した session / terminal を停止する
  - その後も worktree を cwd にした生きたプロセスがないか OS に問い合わせる (lsof)。残っていれば command と PID を一覧表示する
  - プロセス停止の明示確認後は、表示時になかったプロセスを止めないよう再照合して全件へ SIGTERM を送り、終了を確認する。終了していなければ最新の一覧を同じダイアログに表示し、削除へ進まない
  - 追加確認が不要になった時点でダイアログを閉じ、カードを操作不能な `Removing…` 表示にして `git worktree remove` (`force` 承認済みなら `--force`) を実行する
  - 実削除の直前にも新しい session / process がないか再確認する
  - 削除が成功したら metadata の task worktree record も削除する。branch と provider session 履歴は残す
  - 実削除に失敗したら一覧を再取得してカードを実態に合わせ、モーダルは開かない。準備後に dirty / process が発生した場合は warning、その他の失敗は error として Error ログに記録する
- startup maintenance
  - app 起動時に registered repo ごとに `git worktree list` を実行する
  - list に成功した repo だけ、metadata に残った stale task worktree record を削除する
  - repo 自体の cleanup はしない

## UI structure

左カラムは `repo > task worktree` を基本構造にする。
repo row は task worktree が 0 件でも表示し、新規 worktree session の起点になる。

task worktree row は branch、primary session の状態、provider、preview、suggested session の存在を表示する。
row のクリックは常に worktree の選択で、session やプロセスの起動は行わない (F43)。
row に残る操作は選択と `︙ → Remove worktree` (worktree lifecycle) だけである。

session lifecycle の操作は選択中 worktree の Terminal が担う。
表示すべき terminal runtime がない間、Terminal は session start surface を表示する。

- primary がない worktree: suggested session の一覧 (クリックで primary へ昇格して resume) と、
  新規 session (Claude / Codex) の選択肢
- inactive primary がある worktree: primary の preview と resume / detach 操作。
  detach すると primary なしの選択肢に戻り、そこが別 session を始める導線になる
- main worktree: standalone terminal を開く操作

右側の `Terminal`, `Files`, `Changes`, preview は選択中の task worktree に連動する。
App が持つ選択状態は `worktreeId` だけで、右ペイン (SessionView) は worktree ごとに作り直す (P20)。
「その worktree でいま表示している terminal runtime」は SessionView のローカル state で、
session 未開始や終了直後は null になり、その間 Terminal は session start surface を出す。
mount 時は primary session の active な terminal runtime があればそれを表示し、
main worktree では standalone terminal を自動で開く (生きている runtime は IPC 側が再利用する)。
session 操作 (resume / promote / 新規 session / standalone terminal 開始) も SessionView が担う。
進行中の操作は worktree を切り替えると SessionView ごと破棄されるので、
古い結果が表示を引き戻すことはない。
session がなくても `Files`, `Changes`, preview は worktree に対して使える。
terminal runtime の exit では worktree の選択を保ち、表示中 runtime だけを外して
session start surface に戻す。main worktree でも自動では開き直さない。

Terminal の描画には xterm.js を使う。
stable 6.0.0 には IME の変換位置がずれて過去に入力したテキストの断片が再送されるバグがあるため、修正済みの 6.1.0-beta 系(VS Code が本番で使っているのと同じ系列)を使っている。stable 6.0.0 系に戻すと再発する。6.1.0 stable が出たらそちらに移行する。

PTY の出力は main process 側でも headless の xterm.js (`TerminalScreen`) に通し、画面とスクロールバックの状態として保持する。
セッションを切り替えて戻ってきた時は、この状態を serialize addon で復元用シーケンスに変換して renderer の端末に書き込む (VS Code のターミナル復元と同じ方式)。
生の出力ストリームを溜めて再生する方式は、容量制限で先頭を切り落とした時にエスケープシーケンスや TUI の再描画フレームの途中から再生されて表示が壊れるため使わない。

## Appendix

2026-05-16 までアーキテクチャ刷新を行なっていたため、このドキュメントに沿わない古い実装が残っている可能性がある。
移行時の判断と checklist は [task-worktree-first ADR](adr/20260516-task-worktree-first-model.md) に残す。
