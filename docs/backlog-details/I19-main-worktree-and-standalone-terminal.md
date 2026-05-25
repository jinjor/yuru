# I19 main worktree と standalone terminal の整理メモ

Last updated: 2026-05-26

## Purpose

I19 の議論から、main worktree の可視化だけでなく standalone terminal の扱いも関係することが分かってきた。
このメモは、長いセッションや context compaction 後に現在の考えを思い出すための簡単な記録である。

まだ実装途中で方針が変わる可能性があるため、詳細仕様としては扱わない。

## Current intent

- main worktree を repo 配下の card として並べる
- main worktree をクリックしたら standalone terminal が立ち上がる
- main worktree は provider session を bind しない
- main worktree の terminal は、終了して inactive になるような対象としては扱わない
- main worktree の Git branch は card と terminal header に表示する
- main worktree でも Changes / diff / Files はそのまま動作する

## Implementation stance

- 既存の worktree / PTY / Files / Changes / diff の仕組みをできるだけ流用する
- main worktree とそれ以外の worktree は、別物の union として広げすぎない
- 違いは「provider session が bind されているかどうか」を中心に表す
- PTY としての terminal は共通の概念にし、provider session 固有の意味論は別に扱う

## First refactor

初手は、挙動を全く変えずに準備のためのリファクタリングを行う。
現在 provider session と一体になっている runtime / PTY 周りを見直し、terminal として共通化できる部分と provider session 固有の部分を分けやすくする。

## Acceptance condition

最終的に、main worktree と standalone terminal を入れた後の設計が今よりも綺麗になっていること。
