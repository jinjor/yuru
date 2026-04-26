# I1 Safe Worktree Removal

Last updated: 2026-04-26

`I1` は、worktree-first UI で task worktree を安全に削除するための条件判定と UX を決める item。

## Goal

- worktree row の `x` ボタンから、不要になった task worktree を迷わず片付けられるようにする
- safe に消せる場合はそのまま消す
- dirty な場合は警告を出し、ユーザーが明示的に OK したときだけ `git worktree remove --force` する
- squash merge 運用の repo でも、PR merge 済み worktree を「完了済み」と判断できるようにする

## Desired UX

1. ユーザーが worktree row の `x` を押す
2. Yuru が削除可否を判定する
3. clean かつ merged 済みなら確認を出して通常削除する
4. dirty なら、未コミット・未追跡変更が消えることを明示して確認する
5. ユーザーが OK した場合だけ force 削除する
6. active session がまだ動いている場合は、まず停止が必要なことを伝える

## Safety checks

- `git worktree list --porcelain`
  対象 worktree と branch を特定する
- `git -C <worktreePath> status --short`
  dirty / untracked を判定する
- `git merge-base --is-ancestor <branch> <mainRef>`
  fast-forward merge / merge commit の取り込み済み判定に使う
- GitHub PR state
  squash merge / rebase merge では元 branch commit が main の ancestor にならないため、PR が `merged` かを見る

`mainRef` はまず `origin/main` を想定する。
fetch できていない場合は local `main` に fallback する余地はあるが、誤判定を避けるため UI には「最新状態を確認できない」ことを出す。

## Merge detection

Git-only で `merged` と言えるケース:

- branch が `origin/main` の ancestor
- local merge / fast-forward merge 済み
- GitHub の merge commit 運用で branch commits が main 履歴に残る

Git-only では `merged` と言えないケース:

- squash merge
- rebase merge
- branch を消していて local branch と PR の対応だけが残っている

このため、会社 repo のような squash merge 運用では GitHub PR state を見る必要がある。

## GitHub lookup

候補:

- branch 名から PR を探す
- PR が `merged` なら worktree は完了済み候補にする
- PR が `open` なら削除は危険寄りとして警告を強くする
- PR が見つからない、または GitHub が見られない場合は `unknown` として扱う

既存の GitHub 連携は branch から PR を取っているので、まずはその延長でよい。
ただし cache が古いと削除判断に影響するため、削除直前は通常表示用 cache とは別に fresh lookup する方が安全。

## Removal states

- `safe-clean-merged`
  clean で merged 済み。通常削除できる。
- `safe-dirty-merged`
  merged 済みだが dirty。変更が消えることを警告し、OK なら force 削除できる。
- `dirty-unmerged`
  未 merge かつ dirty。強い警告を出し、force は明示 OK のみ。
- `clean-unmerged`
  clean だが未 merge。通常削除は可能だが、branch / PR が未完了の可能性を警告する。
- `unknown`
  merge 状態を確認できない。自動で safe 扱いしない。
- `active`
  provider process が動いている。まず停止が必要。

## Commands

通常削除:

```sh
git worktree remove <worktreePath>
```

force 削除:

```sh
git worktree remove --force <worktreePath>
```

branch 削除はこの item では自動でやらない。
worktree を消しても branch は残るため、branch 整理は別 item として扱う。

## Non-goals

- PR merge 時の自動削除
- branch の自動削除
- provider session 履歴の削除
- Yuru metadata の archive / cleanup 全体設計

PR merge 時の自動整理は `F18` に寄せる。
この item は、ユーザーが `x` を押したときの安全な手動削除に絞る。

## Open questions

- dirty の詳細はファイル数だけで十分か、ファイル一覧まで出すか
- `origin/main` 以外の base branch をどう決めるか
- GitHub が使えない repo では squash merge 済みをどう表示するか
- active session を停止してから削除まで 1 フローにするか、まずは停止を促すだけにするか
