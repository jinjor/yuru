# I19 main worktree の可視化

Last updated: 2026-05-24

## Purpose

Yuru で repo の main worktree の情報を見られないのが不便になってきた。
main branch / main worktree の変更、diff、branch、PR、ファイルを Yuru の画面上で確認できるようにしたい。

## Current design

現在の architecture では、`task worktree` は repo の main worktree を除いた Git worktree と定義されている。
repo list も Git worktree 一覧から main worktree を除外し、左ペインには task worktree だけを並べる。

このため、repo row は新規 worktree session の起点にはなるが、main worktree 自体の Files / Changes / diff / branch / PR / terminal context を見る対象にはならない。

## Direction

main worktree も task worktree と同じ表示単位として扱う案が有力。
つまり、左ペインで repo 配下に main worktree の row/card を出し、他の task worktree と同じように Files / Changes / diff / preview の基準にできるようにする。

この場合、「task worktree」という名前が main worktree を除外する意味を持ち続けると混乱する。
実装上は `workspace worktree` や `worktree item` のような、main と task を両方含む概念を導入する方が読みやすい可能性がある。
ただし用語を増やすと複雑になるため、最初は UI と data model の差分を小さく保てるか確認する。

## Candidate UI

- repo row の下に main worktree card を常に表示する
- main worktree card は branch 名、PR state、変更状態、最新 session preview を表示する
- task worktree と同じクリック操作で Files / Changes / diff を main worktree に切り替えられる
- main worktree に primary session を attach できるかは別途決める

main worktree は削除できない。
task worktree と同じ card を使う場合でも、remove action は出さない。

## Session handling

main worktree も task worktree と同じように session を持てるようにするかは設計判断が必要。

選択肢:

- 表示だけ対応する
  - Files / Changes / diff / branch / PR は見られる
  - Terminal session は task worktree のみ
  - 実装は軽いが、main worktree で作業したい時に中途半端になる
- main worktree にも primary session を attach できるようにする
  - task worktree と同じ体験に近づく
  - metadata schema と repo assembly の前提を見直す必要がある
- standalone terminal として扱う
  - F32 と関係する
  - task worktree list に混ぜない設計とは衝突する可能性がある

現時点では、main worktree を task worktree と同列に扱う案が一番素直に見える。

## Data model considerations

現在の metadata は `taskWorktrees` に repoId / worktreePath / primarySession を持つ。
main worktree は Git の main worktree として常に存在するため、metadata に登録しなくても Git から発見できる。

ただし primary session を attach するなら、main worktree も metadata 上の link を持つ必要がある。
この場合、`taskWorktrees` という名前のまま main worktree を入れると意味がずれる。

検討すべきこと:

- metadata の collection 名を変えるか
- main worktree record を metadata に保存するか
- main worktree の ID を repoId から安定生成するか、path から生成するか
- main worktree と task worktree で UI action の差分をどう表すか

## Relationship to I18

main worktree を表示するなら、I18 の更新 matrix に main worktree も乗せる必要がある。

- branch
- PR
- diff / git status
- 最新メッセージ preview

ただし main worktree に active session がない場合、agent response completed を更新トリガーにできない。
その場合は app active 復帰時や低頻度 refresh の扱いを別途決める。

## Open questions

- main worktree も session を持てるようにするか
- `task worktree` という用語を残すか、main を含む表示単位の名前を作るか
- main worktree の card は task worktree と完全に同じ見た目でよいか
- main worktree の変更状態を repo row に統合する方がよいか
- main worktree を選択中に新規 task worktree を作る導線をどう置くか
