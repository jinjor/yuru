# F41 Worktree Removal

Last updated: 2026-06-18

`F41` は、Yuru の左ペインから task worktree を削除できるようにする機能。

Yuru の主導線は `repo > task worktree` なので、作業が終わった worktree を Yuru 内で片付けられないと、一覧が増え続けて使いにくくなる。
この item は repo 全体の Git cleanup ではなく、Yuru が表示している task worktree を閉じるための機能として扱う。

## Goal

- 不要になった task worktree を左ペインから削除できる
- worktree に未コミット変更や untracked file がある場合でも、明示確認の上で捨てて削除できる
- worktree 削除後に local branch が残ることを UI 上で見落とさない

## Target behavior

1. ユーザーが task worktree の削除操作を選ぶ
2. Yuru が対象 worktree の branch 名と dirty 状態を確認する
3. まず通常の `git worktree remove <worktreePath>` を試す
4. dirty などで通常削除できない場合、変更が消えることを明示して再確認する
5. ユーザーが明示した場合だけ `git worktree remove --force <worktreePath>` を実行する
6. worktree 削除に成功したら、Yuru metadata から対象 task worktree record を消す
7. local branch が残る場合は、そのことを表示し、消せる場合だけ追加操作として branch 削除を提案する

## Branch cleanup

worktree と branch は別のものとして扱う。
worktree 削除は作業ディレクトリの削除であり、branch 削除は履歴への名前を消す操作なので、同じ確認に混ぜない。

最初の実装で branch を扱う場合も、worktree 削除後の追加操作にする。

- branch 名は worktree 削除前に控える
- worktree 削除が成功した後だけ branch 削除に進める
- branch 削除は `git branch -d <branch>` のみ使う
- `git branch -d` が拒否した場合は branch を残し、理由を表示する
- `git branch -D` はこの item では扱わない
- remote branch は削除しない

## Dirty worktree

dirty worktree を片付けられない削除機能は実用上つらい。
ただし `--force` は未コミット変更や untracked file を捨てる操作なので、通常削除とは別の明示確認にする。

確認文言では、少なくとも次を伝える。

- 未コミット変更が消える
- untracked file が消える
- branch や provider session 履歴は削除しない

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

local branch の安全削除:

```sh
git branch -d <branch>
```

## Non-goals

- repo 全体の merged branch cleanup
- remote branch の削除
- `git branch -D` による強制 branch 削除
- provider session 履歴の削除
- PR merge 時の自動整理

PR merge 時の自動整理は `F18` に寄せる。

## Open questions

- dirty 状態の詳細はファイル数だけ出すか、ファイル一覧まで出すか
- branch 削除提案を最初の実装に含めるか、worktree 削除だけで切るか
- worktree 削除後の primary session link を hidden / detached / missing のどれとして扱うか
