# F41 Worktree Removal

Last updated: 2026-06-18

`F41` は、Yuru の左ペインから task worktree を削除できるようにする機能。

Yuru の主導線は `repo > task worktree` なので、作業が終わった worktree を Yuru 内で片付けられないと、一覧が増え続けて使いにくくなる。
この item は repo 全体の Git cleanup ではなく、Yuru が表示している task worktree を閉じるための機能として扱う。

## Goal

- 不要になった task worktree を左ペインから削除できる
- worktree に未コミット変更や untracked file がある場合でも、明示確認の上で捨てて削除できる

## Target behavior

1. ユーザーが task worktree の削除操作を選ぶ
2. まず通常の `git worktree remove <worktreePath>` を試す
3. dirty などで通常削除できない場合、変更が消えることを明示して再確認する
4. dirty の詳細は出さない。削除できない理由と、force 削除で変更が消えることだけを伝える
5. ユーザーが明示した場合だけ `git worktree remove --force <worktreePath>` を実行する
6. worktree 削除に成功したら、Yuru metadata から対象 task worktree record を消す
7. primary session link は task worktree record と一緒に消える。provider session 履歴自体は削除しない

## Branch cleanup

worktree と branch は別のものとして扱う。
worktree 削除は作業ディレクトリの削除であり、branch 削除は履歴への名前を消す操作である。

この item では branch を削除しない。
local branch cleanup は worktree を使わない通常作業でも起きる repo 管理の問題なので、Yuru の worktree 削除機能には背負わせない。

## Dirty worktree

dirty worktree を片付けられない削除機能は実用上つらい。
ただし `--force` は未コミット変更や untracked file を捨てる操作なので、通常削除とは別の明示確認にする。

確認文言では、少なくとも次を伝える。

- 未コミット変更が消える
- untracked file が消える
- branch や provider session 履歴は削除しない

dirty の詳細なファイル一覧や件数は出さない。
必要ならユーザーは削除前に Changes / Files / Git CLI で確認できるため、削除確認は判断に必要な最小限の情報に絞る。

## Active session

active な provider session / standalone terminal がある worktree は、まず削除しない。
削除操作では「実行中の session を停止してから削除する必要がある」ことを表示する。

active session の停止まで 1 フローにまとめるかは、この item の初期実装では扱わない。

## Commands

通常削除:

```sh
git worktree remove <worktreePath>
```

force 削除:

```sh
git worktree remove --force <worktreePath>
```

## Non-goals

- repo 全体の merged branch cleanup
- local branch の削除
- remote branch の削除
- `git branch -D` による強制 branch 削除
- provider session 履歴の削除
- PR merge 時の自動整理

PR merge 時の自動整理は `F18` に寄せる。
