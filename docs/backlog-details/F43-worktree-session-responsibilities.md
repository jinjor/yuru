# F43 worktree の作成・選択と session 操作の分離

Last updated: 2026-07-15

## Goal

Yuru の操作を worktree-first に揃える。

worktree を作る・見つける・選ぶことと、その worktree で agent session を開始・復元することを分ける。Yuru が新しく作った worktree も、すでに Git に存在していた worktree も、存在した後は同じ操作と状態を通るようにする。

```text
Yuru で新しく作る ─┐
                    ├─> worktree が存在する
Git から見つける ──┘       └─> worktree を選択する
                              └─> Terminal で session を選ぶ
                                    └─> primary session になる
```

新規作成専用の session flow を持たず、「session が紐づいていない worktree を選択し、Terminal から session を始める」という一つの flow に統一することが、この item の中心である。

## Why

### worktree と session は同じ寿命ではない

worktree は branch のファイル、Git の変更、Files、Changes、file preview などを含む作業場所である。session は、その作業場所で Claude または Codex と対話するための実行単位である。

worktree は session がなくても存在できる。session を停止したり primary の紐付けを外したりしても、worktree とその変更は残る。反対に worktree を削除すると、その session が作業対象にしていたファイルの場所までなくなる。この影響範囲の違いを UI の責任にも反映したい。

### 現在の card は worktree 選択と session 操作を兼ねている

現在の task worktree card は primary session の有無で役割が変わる。

- primary session がある card は session を選択または復元する
- primary session がない card は既存 session の復元または新規 session の開始を促す

そのため primary session がない worktree は、Files や Changes を見たいだけでも通常の作業対象として選べない。また session の紐付け解除を card の menu に加えると、session に対する操作と worktree 削除が近い導線に並び、対象を取り違える危険がある。

### 新規作成と既存 worktree で session 開始の flow が分かれている

repo の `+` では、最初に provider を選び、worktree の作成と primary session の開始を一つの処理として行う。一方、session が紐づいていない既存 worktree では、worktree を作らずに Claude / Codex の新規 session を開始する。

session を開始するという同じ目的に対して、新規 worktree だけ別の UI と backend flow を持っている。provider の起動に失敗すると、すでに成功した worktree 作成まで巻き戻す必要も生じている。

worktree 作成を独立させれば、新規 worktree も作成直後から「worktree は選択されているが、session はまだ始まっていない」状態になる。その後は、現在すでにある既存 worktree 向けの session 開始と同じ考え方を使える。

### worktree の置き場所を最初の provider が決める必要はない

現在は最初に選んだ provider によって、新規 worktree の path が変わる。

- Claude: `.claude/worktrees/<worktreeName>`
- Codex: `.yuru/worktrees/<worktreeName>`

しかし作成後の worktree では、Claude から Codex、Codex から Claude のどちら向きでも新規 session を開始できる。worktree 自体は provider に所有されていないため、最初の provider だけが配置場所を決める状態をやめたい。

## What

### Worktree lifecycle

- repo の `+` は branch と task worktree を作る
- worktree 作成時には Claude / Codex を選ばない
- 作成に成功した worktree は、session をまだ開始せずに選択する
- 作成直後の右ペインは Terminal を表示し、Claude / Codex の選択肢をすぐ操作できる状態にする
- Git にすでに存在する worktree も同じように選択できる
- primary session の有無にかかわらず、task worktree card は worktree を選択する
- worktree の削除は worktree lifecycle の操作として card 側に残す

worktree 作成と session 開始を別の成功・失敗として扱う。session の起動に失敗したことを理由に、作成済み worktree を削除しない。

### Session lifecycle

選択中 worktree の session は Terminal の関心として扱う方向で設計する。Terminal は少なくとも次の状態を扱う。

- primary session がない
- primary session はあるが active runtime がない
- active runtime がある

session の新規開始、既存 session の復元、primary の切り替え、停止なども Terminal 側の操作として整理する。左ペインには provider、active 状態、preview など複数 worktree を見渡すための要約を残してよいが、card 自体の基本動作は worktree 選択とする。

選択中 worktree に terminal session がなくても、Files、Changes、file preview など session に依存しない右ペインは利用できるようにする。

### 新規作成後も既存 worktree と同じ session 開始 flow を使う

新しく作成した worktree も、すでに存在する worktree も、選択後は同じ Terminal から session を開始する。

```text
repo の +
  └─> worktree を作成
        └─> session を開始せず、その worktree を選択 ─┐

session が紐づいていない既存 Git worktree
  └─> その worktree を選択 ──────────────────────────┴─> Terminal に Existing / Claude / Codex を表示
                                                            └─> 選んだ session を primary にする
```

作成後にもう一度 card を選んだり session 操作の入口を探したりする必要はない。新しい worktree を選択した Terminal まで自動的に遷移し、Claude / Codex を選べるところから続けられるようにする。

具体的な選択肢の見た目は次の設計作業で決める。新規作成と既存 worktree はどちらも「worktree は選択されているが、session はまだ始まっていない」状態になり、その後の session flow を共有する。

## Worktree placement

Yuru が新しく作る task worktree は、最初に使う provider にかかわらず `.yuru/worktrees/<worktreeName>` に統一する。

これにより path は Yuru が決め、Claude / Codex はその worktree で session を開始する provider になる。既存の `.claude/worktrees` と `.yuru/worktrees` にある worktree は引き続き Git worktree として扱い、移行の要否は実装前に決める。

repo 内の `.yuru` は、ignore されていない project で未追跡ファイルとして現れる問題があり、`B7` では repo 内の `.yuru` をやめる予定になっている。F43 では provider 別の配置を廃止して Yuru 管理へ統一する。B7 によって保存 root を repo 外へ移す場合も、Claude 用と Codex 用には分け直さない。

## Required spike

F43 の実装前に、`.yuru/worktrees` にある worktree で Claude が Yuru の想定どおり動くことを実機で確認する。

現在の Yuru は `claude --worktree` に作成を任せず、Yuru が Git worktree を作り、Claude に作業対象の path を伝えている。ただし `.claude/worktrees` 以外の path に Yuru から Claude session を開始する一連の動作は、推測ではなく spike で確認してから統一する。

spike では少なくとも次を確認する。

- `.yuru/worktrees` にある session が紐づいていない worktree で、新規 Claude session を開始できる
- Claude のファイル操作とコマンド実行が main worktree ではなく対象 worktree に向く
- session を終了して resume しても、同じ worktree との対応を維持できる
- app restart 後も primary / suggested session の検出が崩れない

この spike はこのドキュメント作成時には実施しない。結果に基づく実装上の判断は、次の作業セッションで行う。

## Design work for the next session

次の設計作業では、このドキュメントの責任分担と共通 flow を前提に、具体的な interaction を決める。

- repo の `+` で入力する worktree 情報
- 選択中 worktree に session が紐づいていない時、Terminal で Existing / Claude / Codex をどう提示するか
- inactive primary の復元を明示操作にするか、worktree 選択に伴って行うか
- active session の切り替えや停止をどこから操作するか
- 左ペインの session 要約をどこまで操作可能にするか
- 選択中 worktree と表示中 terminal runtime の関係を状態としてどう表すか
- B7 と両立する Yuru 管理 worktree の最終的な保存 root
- 既存の `.claude/worktrees` / `.yuru/worktrees` を移行するか、そのまま扱うか

具体的なレイアウト、アイコン、文言、popover / dialog の形式はここでは決めない。

## Relationship to F44

primary session と worktree の紐付け解除は `F44` で扱い、F43 の後に実施する。

F43 によって worktree は session なしでも選択でき、Terminal が session lifecycle を扱えるようになる。F44 はその上で、worktree や provider の session 履歴を削除せず、primary の関連だけを外す操作として設計する。active runtime をどう終了させるかを含む interaction は F43 の具体設計後に決める。

## Non-goals

- F44 の紐付け解除を実装すること
- 同じ worktree で複数 agent を並行作業させる仕組みを追加すること
- worktree 削除の挙動を変更すること

## Acceptance

- provider を選ばずに task worktree を作成できる
- 作成した worktree が選択され、Terminal に Claude / Codex の選択肢がすぐ表示される
- Yuru が新規作成する worktree の配置が最初の provider によって変わらない
- 新規作成した worktree と既存 Git worktree が、存在した後は同じ選択・session 開始 flow を使う
- session が紐づいていない task worktree も選択できる
- session がなくても、選択中 worktree の session 非依存の右ペインを利用できる
- Terminal が選択中 worktree の session 状態と session lifecycle 操作を担う
- worktree lifecycle と session lifecycle の操作導線が区別されている
- `.yuru/worktrees` 上の Claude session が成立することを、実装前 spike の結果で確認している
