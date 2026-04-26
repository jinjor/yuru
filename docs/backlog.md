# Backlog

Last updated: 2026-04-26

Yuru の backlog。
UI 改善も機能追加も同じ土俵で扱う。
ここでは「次に何をやるか」を管理し、実装の細部や現状の正しさはコードを読む前提にする。
優先順位は、分類よりも「自分が早く仕事に使えるか」で決める。

## How to read this

- `Type`: `bug`, `polish`, `feature`, `investigate`
- `Now`: 今のテンションや作業効率に直結するもの
- `Next`: その次に効きそうなもの
- `Later`: 欲しいが、今すぐでなくてよいもの
- 詳細メモが必要な item は `docs/backlog-details/<ID>-*.md` に置く

## Priority lens

- バグでも、普段ほぼ触らない機能なら優先度は高くない
- 見た目でも、テンションや使いやすさに効くなら優先して直す
- 機能は、仕事で使う頻度が高いものほど優先する
- 「壊れているか」よりも「早く仕事に使いたいか」を優先軸にする

## V1 -> V2 Migration

このセクションは、V1 から V2 への移行のためのストーリー一覧である。
背景設計は [docs/architecture-v2.md](architecture-v2.md) を参照する。
いまは `Now` よりもこちらを優先する。

1. [x] Claude の worktree session 検出が成立するかを spike で確認する
2. [x] Codex の worktree session 検出が成立するかを spike で確認する
3. [ ] ダミーの metadata で repository 一覧を表示できる
4. [ ] `yuru add` で repository を Yuru 上で見ることができる
5. [ ] `Workspace` コンポーネントを `SessionView` に rename できる
6. [ ] backend で Files / Changes / Diff が参照する作業ルートを、`cwd` 直結ではない中立な概念として扱える
7. [ ] repository から新規 worktree セッションを開始できる
8. [ ] primary session のアイテムに active / inactive が表示できる
9. [ ] primary な worktree から既存セッションを再開できる
10. [ ] primary session のアイテムに provider が表示できる
11. [ ] primary session のアイテムに preview 文字列が表示できる
12. [ ] Claude の suggested worktree session を表示できる
13. [ ] サジェストされた worktree session を primary に昇格できる
14. [ ] Codex の suggested worktree session を表示し、primary に昇格できる
15. [ ] primary session のアイテムに branch 名が表示されている
16. [ ] V1 の session-first 実装を削除できる

## Now

| ID | Type | Area | Item | Why now |
|---|---|---|---|---|
| F15 | feature | Search | コード検索 | repo 全体を横断してすぐ探したい |
| F20 | feature | App | アプリのアイコンを付ける | テンションとプロダクト感を上げたい |
| I9 | investigate | App Runtime | build/restart 後にたまに白画面になる原因を調べる | 開発中の再起動ループで不安になる |
| I1 | investigate | Sessions | worktree を安全に削除できる条件と UX を決める | squash merge 運用でも作業済み worktree を迷わず片付けたい |
| B3 | bug | Sessions | 古いセッション選択時の `No conversation found with ID: ...` のちらつきを消す | 誤解を生む |
| B6 | bug | Diff | `loading diff...` のちらつきを消す | 差分を見るたびにノイズになる |
| P11 | polish | Sessions | 最新会話プレビューが一覧に同期されない問題を直す | 一覧の情報鮮度が低い |
| B5 | bug | New Session | hover ハイライトが `WT` の手前で不自然に切れる問題を直す | 明確な UI バグ |

## Next

| ID | Type | Area | Item | Notes |
|---|---|---|---|---|
| F16 | feature | GitHub | セッションカードに PR の有無と状態を表示する | GitHub 連携として早めに価値が出そう |
| F17 | feature | GitHub | PR へのリンクを出す | そこそこ早めに欲しくなりそう |
| F1 | feature | Notifications | 並列実行セッションの完了通知を出す | 完了に気づけない |
| P7 | polish | New Session | `WT` 表示を置き換える | 文言かアイコンかを再検討 |
| P8 | polish | New Session | Claude / Codex のアイコンを出す | Sessions 側とトーンを揃えたい |
| P9 | polish | New Session | 長い repo path の省略ルールを見直す | 折りたたみが不自然 |
| P13 | polish | Files | Files タブのアクション UI を整える | 階層感が弱く見た目もまだ野暮ったい |
| F3 | feature | Changes | 変更行数も出す | diff 集計で対応したい |
| F4 | feature | Diff | 各ファイルの変更行数表示 | Changes と整合させたい |
| F5 | feature | Diff | 右端スクロール領域に差分位置マーカーを出す | minimap 的な把握用 |
| F7 | feature | Terminal | ファイル名が改行を跨いでもリンクできるようにする | linkifier 改善 |
| F8 | feature | Terminal | ファイルクリック時にツリー側も開く | navigation の連動 |
| F9 | feature | Terminal | ウィンドウを広げた時に 1 行の文字数を増やす | xterm fit を調整 |
| F25 | feature | Updates | Yuru の更新通知を出す | ローカル build 運用だと更新に気づきにくい |
| F33 | feature | App Runtime | 起動元ごとに `start/stop/restart` できるようにする | 複数起動時に別の Yuru を巻き込まないようにしたい |
| F32 | feature | Terminal | task worktree 外の作業を standalone terminal として分離する | V2 移行後の補助導線として欲しい |
| I10 | investigate | Files | 自前 tree で大量のファイルを表示した時の重さ対策を考える | 切り替え後に実測して判断したい |
| F28 | feature | Files | ファイル検索の最近開いたファイル履歴 | Cmd+P 空入力時に履歴を出したい |
| I11 | investigate | App | モーダルとショートカットの管理設計を決める (詳細: docs/backlog-details/I11-modal-management.md) | FileSearch 導入時に Cmd+P が他モーダル裏で発火する問題が出たため、場当たり対応せず設計として直したい |

## Later

| ID | Type | Area | Item | Notes |
|---|---|---|---|---|
| F10 | feature | Terminal | ターミナル内文字列検索 | 独立機能として実装したい |
| F11 | feature | Diff | ファイル単位の既読管理 | 状態設計が必要 |
| F12 | feature | Diff | Split mode | 面積と複雑さが増える |
| F13 | feature | Files / Code | 選択範囲をターミナルに貼り付ける | editor と terminal の連携が必要 |
| F18 | feature | GitHub | PR マージ時に worktree を自動整理する | 自動 archived までつなげたい |
| F24 | feature | Empty state | 空画面から新規セッションを始められるようにする | あると親切だが、今すぐではない |
| I6 | investigate | Sessions / Terminal | セッション終了時メッセージの表示保持を見直す | 終了直前の案内や要約をその場で読めないと戸惑いやすい |
| I7 | investigate | Sessions / Persistence | セッション終了メッセージの再到達性をどう担保するか決める | あとから確認できる保証がないと次の操作で迷いやすい |
| I8 | investigate | Dependencies | 依存更新の安全運用を決める | minimum release age や通知方針を整理したい |

## Open decisions

- 変更ファイル数・変更行数の集計は都度計算かキャッシュか
