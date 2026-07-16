# F44 primary session と worktree の紐付け解除

Last updated: 2026-07-16

## Goal

primary session と task worktree の strong link だけを外せるようにする。
worktree・Git の変更・provider store の session 履歴は消さない。
紐付けを外した session はあとから suggested として再発見でき、
同じ worktree を別 provider の session に引き継げるようにする。

## 前提 (F43 の結果)

- worktree の選択と session の操作は分離済み。session lifecycle の操作は
  選択中 worktree の Terminal (session start surface) が担う
- primary の strong link は Yuru metadata が持ち、作成または昇格の明示操作でだけ変わる
- `attachPrimarySessionByPath` は同じ worktree の既存 primary を置き換え、
  同じ session が別 worktree の primary だった場合はそちらの link を外す

## F43 から持ち越した設計課題

- **primary session を持つ worktree の Terminal には Resume だけを出している。**
  New Session / Existing Session の選択肢は意図的に出していない。
  新規 session を開始すると既存 primary の紐付けが黙って置き換わるためで、
  紐付けの解除・切り替えの見せ方が決まるまで導線を作らない判断をした
  (詳細: [F43-design.md](F43-design.md))。
  F44 では紐付け解除とセットで、この worktree で別の session を始める導線を設計する
- active runtime を持つ primary の紐付けを外す時に、動いているプロセスを
  どう終了 (または放置) するかの interaction
- 紐付け解除・切り替えの操作を session start surface / 実行中 Terminal の
  どこに置くか。card 側の worktree lifecycle 操作 (削除) と混ざらないようにする
