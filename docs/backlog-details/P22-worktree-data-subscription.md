# P22 worktree の表示データを worktreeId 単位の取得・購読にする

Last updated: 2026-08-03

## 何が問題か

worktree の表示データ (branch、PR バッジ、primary / suggested session の状態と preview) は
App が repos として一括保持し、SessionView へは worktree オブジェクトを props で
そのまま渡している。左ペインが必要とするデータを右ペインがおすそ分けされている構図。

このため session の push が 1 件届くたびに App の state 全体が更新され、
再描画が無関係なコンポーネントまで波及する。F51 (keep-alive) で SessionView の
instance が複数 mount されると、この波及が instance 数分に増える。

F51 では暫定対策として「applySessionUpdate の参照保存 + memo(SessionView)」を入れるが、
これは「App が全部持って配る」構造を保ったままの延命策
(詳細: F51-keep-alive-open-issues.md の 13)。

## ゴール

- SessionView は `worktreeId` だけを受け取り、表示データは自分で取得・購読する
- 左ペインのカード (RepoList の row) も同様に、自分の worktree のデータだけを受け取る
- App が持つのは repo / worktree の ID と並び順程度の骨組みと、選択状態だけ
- push は該当する購読者にだけ届き、ブロードキャスト再描画が構造的に消える
- これに伴い `applySessionUpdate` と、F51 の参照保存対策およびそのテストは削除できる

## 関連

- P17: repos 一覧を痩せさせてセッション表示状態はカード側が個別取得する、という
  同じ方向の main 側の話。この item の一部として実施するのが自然
- I16: worktree 単位の購読 / 解除の設計は backend event の発火・購読設計の整理そのもの
- F51: この item の動機。F51 側の暫定対策は本 item の完了で不要になる
