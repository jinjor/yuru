# F44 primary session と worktree の紐付け解除

Last updated: 2026-07-19

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

## 設計記録 (2026-07-19)

持ち越した 3 つの課題への決定。

### 操作の置き場所: session start surface だけに置く

inactive primary の surface (Primary Session セクション) の Resume 行の下に、
`Detach session` 行を並べる。card 側には置かない (card は worktree lifecycle 専用、F43)。
実行中 Terminal にもメニューは作らない (次項)。

detach は metadata の strong link を消すだけで、provider store の履歴が残り
suggested として 1 クリックで戻せるため、確認ダイアログは出さない。

### active runtime を持つ primary は detach できない

「動いているプロセスをどう終了するか」の interaction は作らない。
セッションの停止は従来どおり terminal 内での操作 (exit / Ctrl+C) とし、
プロセスが終了すると surface に戻るので、そこで detach する。

- 動いているプロセスを Yuru が止める確認 UI・実行中 Terminal のメニューが不要になる
- 「detach したのにプロセスだけ生きている」状態を作らない。active runtime を放置して
  detach すると、worktree には active terminal runtime 由来の primary 表示が残り
  (repo-list の fallback)、解除したはずの紐付けが見え続けてしまう

UI は inactive の時だけ Detach を出すが、一覧が古い場合に備えて service 側でも
active runtime が生きていれば拒否し、error center に出す。

### 別 session を始める導線: detach 後の surface がそのまま導線になる

detach すると一覧の再取得で primary なしの surface (Existing Session / New Session) に
切り替わり、そこから別 provider の新規 session や既存 session の昇格ができる。
primary を持つ worktree に New Session の選択肢を直接出すことはしない。
紐付けの置き換えは必ず「解除 → 開始」の 2 段階の明示操作にし、
F43 で懸念した「新規 session 開始で既存 primary が黙って置き換わる」を起こさない。

detach した session の再発見は provider store の証跡 (path hint) による推測なので、
worktree 内のファイルに触れていない session は Existing Session に出ないことがある。
その場合も履歴は provider 側に残っている。

### Backend

- 新 IPC `worktreeSession:detachPrimary(worktreeId, providerSessionKey)` →
  `YuruService.detachPrimarySession`。worktree と primary の一致を検証し、
  active runtime が生きていなければ既存の `detachPrimarySessionByPath` で
  metadata から strong link を消す。renderer は成功後に一覧を取り直す
