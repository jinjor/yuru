# I7 Session Exit Reachability

Last updated: 2026-04-12

`I7` は、セッション終了時メッセージを後からどう見返せるようにするかの実装メモ。
表示のその場 UX は `I6` として分け、ここでは再到達性と補助保存の方針を扱う。

## Goal

- 終了時にだけ出た重要な案内を、必要になったときにたどれるようにしたい
- provider の履歴を source of truth とする方針を崩しすぎない
- Yuru 独自保存が必要なら、その範囲を UI の補助状態に留めたい

## Problem statement

- provider 側の履歴や session 一覧に、終了時メッセージが残るとは限らない
- そのため「後でも同じ session を選べば見られる」とは限らない
- self-update のように、終了メッセージが次の操作案内を兼ねる場合は影響が目立つ

## Questions

- provider 側で残る情報だけに頼る方針で十分か
- Yuru が独自に終了メッセージを保存するなら、どの粒度まで許容するか
- terminal buffer 全体ではなく、最後の数行だけ保持する形で十分か
- session 一覧や detail panel に、終了時の補助情報を出す余地があるか
- provider ごとに残る情報が違っても、共通の UI を作れるか

## Possible directions

- provider 任せにする:
  後から見られる保証は持たず、残っている履歴だけを使う
- 最後の数行だけ補助保存する:
  完全な transcript ではなく、終了時メッセージだけを UI 用に保持する
- 終了理由と再開導線だけ正規化して保存する:
  元の文面は保存せず、「resume 可」「usage あり」などの最小情報に寄せる
- 保存しない代わりに再開導線だけ出す:
  情報の再現ではなく、次の操作に必要な最小導線だけ担保する

## Relation to architecture

- `docs/architecture.md` の方針では、Yuru 独自の永続化は UI 状態のような補助情報に限定したい
- この item で補助保存を許容するなら、「provider の source of truth の複製ではない」と言える形に寄せる必要がある

## Priority note

- `I6` で表示保持だけで十分なら、こちらの優先度は下げられる
- 逆に provider 依存で見返せないケースが多いなら、別途設計が必要になる
