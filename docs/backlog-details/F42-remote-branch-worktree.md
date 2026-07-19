# F42 remote branch から task worktree を作る

Last updated: 2026-07-19

## Goal

他人や別環境で作った branch を、Yuru の task worktree としてすぐ開けるようにする。
典型的な流れは、GitHub の PR ページで head branch 名をコピーし、
Yuru の Create Worktree モーダルにペーストして worktree を作る。

使う場面:

- コードレビューをエージェントと相談したり、コードを見ながら進める
- 他のセッションや他の人が作った PR を引き継いで作業する

既存の「新しい branch を切って worktree を作る」に対する第 2 の作成方法で、
branch が remote (origin) からの取り込みになる点だけが違う。

## UI

- repo row の `+` で開く Create Worktree モーダルに 2 つのモードを置き、タブで切り替える
  - `New branch`: 現行どおり。生成した branch 名を初期値に、HEAD から新しい branch を切る
  - `From origin`: 空の入力に origin の branch 名をペーストして取り込む
- 入力値はモードごとに保持する (タブを行き来しても入力が消えない)
- 作成中 (fetch はネットワークを待つ) は Create ボタンを無効化して `Creating…` を表示し、二重送信を防ぐ
- 作成中でもモーダルは閉じられる (fetch がハングした時に閉じ込めない)。
  閉じた・開き直した後に届いた結果はモーダルや選択状態に反映しない。
  作成が成功していれば worktree は一覧の更新 (worktree watcher の push) で現れ、
  失敗は error center に残る
- 失敗 (branch が origin に無い、local branch が既にある等) はモーダル内にエラー表示し、モーダルは閉じない

## Git 操作 (From origin)

1. `git fetch origin refs/heads/<branch>`
   - 取り込みと存在確認を兼ねる。標準の fetch refspec なら remote-tracking ref
     (`origin/<branch>`) もこの fetch で更新される (single-branch clone のような
     特殊な refspec は前提にしない)
   - branch 名を `refs/heads/` 付きで渡すのは、branch 名がオプションとして
     解釈される余地をなくすため
2. `git worktree add --track -b <branch> <worktreePath> origin/<branch>`
   - local branch は remote と同名で作る。PR の head branch 名と一致するので、
     既存の PR polling がそのまま PR バッジを表示する
   - upstream が `origin/<branch>` になるので、その後の pull / push がそのまま使える

## 共通ルール (New branch と同じ)

- worktree name は branch 名の `/` を `-` に置き換える
- worktree path は `<repo>/.yuru/worktrees/<worktreeName>`
- 既存 directory / 既存 local branch がある場合は作成しない
  (branch の判定は `refs/heads/` のみを見る。同名の tag があっても作成できる)
- session は開始せず、作成した worktree を選択状態にする (F43)

## スコープ外

- remote の選択。origin 固定にする
- fork からの PR (origin に head branch が無い)。必要になったら
  `refs/pull/<n>/head` の取り込みとして F47 側で考える
- PR 一覧からの選択。「自分が reviewer になっている PR から選ぶ」などの拡張は
  F47 として Later に置き、このフローで不便を感じてから設計する
