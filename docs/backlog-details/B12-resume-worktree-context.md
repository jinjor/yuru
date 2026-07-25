# B12 resume したセッションに worktree の作業指示が引き継がれない

Last updated: 2026-07-25

`B12` は、Yuru が resume したセッションで、agent が task worktree ではなく repo root を
作業場所だと思い込む不具合のメモ。
調査時点の記録であり、以後メンテはしない。

## 症状

task worktree に紐づくセッションを resume すると、agent が repo root を作業場所として扱う。
ファイルの読み書き・ビルド・テストが worktree の外で行われうる。

## 何が起きているか

Yuru は新規セッションを repo root で起動する（セッションの保存先を安定させるため）。
そのうえで「作業は worktree で行え」という指示 (`worktree-context-prompt.ts`) を
**起動時引数**として渡し、cwd と実際の作業場所のズレを埋めている。

- claude: `--append-system-prompt <prompt>`
- codex: `-c developer_instructions=<prompt>`
- kimi: 通常の user message (`initialInput`)

起動時引数で渡したシステムプロンプトは会話履歴に残らない。
そして resume 経路 (`createResumeLaunch`) はこの指示を渡していないため、
再開したセッションからは指示が消える。cwd は repo root のままなので、
agent はそこを作業場所だと判断する。

kimi だけは指示を通常のメッセージとして送っているため履歴に残り、resume 後も生き残る。

## 顕在化する条件

resume 前に worktree 内で作業していれば、会話履歴にそのパスが残るので、
agent は指示が無くても作業場所を履歴から推測できる。
今回顕在化したのは **resume 前に何も作業していなかった**セッションで、
履歴に手がかりが無かったため。この意味では例外的なケース。

## 修正の方向性（決め打ちしない）

resume 時に同じ指示をそのまま再注入するのは適切でない。
作業する worktree を途中で切り替えることがあり、
古い worktree を指す指示が戻ってくると、切り替えた先の作業を邪魔する。

- 起動時に固定するのではなく、現在紐づいている worktree に追従する渡し方にする
- 起動時引数に依存しない形（履歴に残る形）で渡すことも選択肢だが、
  会話が長くなるほど埋もれる点は kimi と同じ弱さを持つ
- codex は resume サブコマンドで `-c developer_instructions` が通るか確認が必要
