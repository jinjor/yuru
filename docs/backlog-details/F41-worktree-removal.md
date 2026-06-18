# F41 Worktree Removal

Last updated: 2026-06-19

`F41` は、Yuru の左ペインから task worktree を削除できるようにする機能。

Yuru の主導線は `repo > task worktree` なので、作業が終わった worktree を Yuru 内で片付けられないと、一覧が増え続けて使いにくくなる。
この item は repo 全体の Git cleanup ではなく、Yuru が表示している task worktree を閉じるための機能として扱う。

## Goal

- 不要になった task worktree を左ペインから削除できる
- 未コミット変更や untracked file は、ユーザーが明示した場合だけ捨てて削除できる
- open PR があると分かっている worktree は、削除に明示的な続行意思を必要とする

## Target behavior

1. ユーザーが task worktree の削除操作を選ぶ
2. active な provider session / standalone terminal がある場合は削除しない
3. open PR があると分かっている場合は、ユーザーが削除を続行する意思を明示した場合だけ先に進む
4. 通常の `git worktree remove <worktreePath>` を試す
5. dirty などで通常削除できない場合は、ユーザーが force 削除を続行する意思を明示した場合だけ `git worktree remove --force <worktreePath>` を実行する
6. worktree 削除に成功したら、Yuru metadata から対象 task worktree record を消す
7. primary session link は task worktree record と一緒に消える。provider session 履歴自体は削除しない

## Pull request

open PR は、worktree を削除すると作業を追いにくくなることを示す注意材料として扱う。
ただし削除の完全なブロック条件にはせず、削除する場合でも branch と PR は残す。

PR 情報は GitHub などの provider から取得できた場合だけ使う。
この item では remote branch や local branch から PR 相当の状態を推測しない。
誤って削除した場合の復帰導線は `F42` に寄せる。

## Branch cleanup

worktree と branch は別のものとして扱う。
worktree 削除は作業ディレクトリの削除であり、branch 削除は履歴への名前を消す操作である。

この item では branch を削除しない。
local branch cleanup は worktree を使わない通常作業でも起きる repo 管理の問題なので、Yuru の worktree 削除機能には背負わせない。

## Dirty worktree

dirty worktree を片付けられない削除機能は実用上つらい。
ただし `--force` は未コミット変更や untracked file を捨てる操作なので、通常削除とは別の明示確認にする。

force 削除では、少なくとも次を判断材料にする。

- 未コミット変更が消える
- untracked file が消える
- branch や provider session 履歴は削除しない

dirty の詳細なファイル一覧や件数は出さない。
必要ならユーザーは削除前に Changes / Files / Git CLI で確認できるため、削除確認は判断に必要な最小限の情報に絞る。

## Active session

active な provider session / standalone terminal がある worktree は、まず削除しない。
削除するには、実行中の session / terminal を先に停止する必要がある。

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
- PR から task worktree を import する導線
- local branch の削除
- remote branch の削除
- remote branch や local branch から PR の有無を推測すること
- `git branch -D` による強制 branch 削除
- provider session 履歴の削除
- PR merge 時の自動整理

PR merge 時の自動整理は `F18` に寄せる。
