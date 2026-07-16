# P20 表示中 terminal runtime の状態と session 操作を SessionView に移す

Last updated: 2026-07-17

## Goal

App が持つ選択状態を `selectedWorktreeId` だけにして、
「その worktree でいま表示している terminal runtime」を SessionView のローカル state に移す。
runtime を扱う session 操作 (resume / promote / 新規 session / standalone terminal 開始) も
state と一緒に SessionView へ移す。

## Why

worktree の選択は App 全体の関心 (左ペインと右ペインの同期) だが、
表示中 runtime は選択中 worktree の中だけの関心で、階層が一段深い。
現在はこの 2 つが App の 1 つの selection に同居しているため、
session 操作の handler 群が App に置かれ、SessionView → TerminalSessionStart へ
複数の props で配管されている。

SessionView は `key={worktreeId}` で worktree ごとに作り直されるので、
表示中 runtime はコンポーネントの寿命と一致するローカル state になる。

## 期待する効果

- App に残るのは repos データ、`selectedWorktreeId`、worktree lifecycle (作成・削除)、
  app chrome (sidebar / errors) だけになる
- `selectionRequestRef` による race ガード (進行中の resume の結果が選択を引き戻すのを防ぐ) が
  不要になる。worktree を切り替えると古い SessionView ごと unmount されるため、
  無効化が手動の帳簿ではなく構造で起こる
- main worktree の「クリックで standalone terminal を開く」特例を App から消せる。
  App は選択するだけにし、main の SessionView が mount 時に terminal を開く
  (既存 runtime の再利用は openWorktreeTerminal の IPC が既に行っている)。
  card クリックの意味が全 worktree で「選択」に統一される

## 留意点

- session 開始後に左ペインの dot / preview を更新する経路は必要。
  refresh callback を 1 本残すか、backend からの `repos:changed` push に寄せる (I16 と関連)
- `onTerminalRuntimeExited` の購読が App から SessionView に移る
- F44 で session lifecycle 操作 (紐付け解除・切り替え) が増える前に行うと、
  App の再肥大を防げる
