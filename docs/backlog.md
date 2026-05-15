# Backlog

Last updated: 2026-05-16

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

## Now

| ID | Type | Area | Item | Why now |
|---|---|---|---|---|
| F38 | feature | Tests | provider 挙動の integration / e2e テスト基盤 | `design-properties.md` の性質（resume prompt 出ない、context 注入が hidden、etc.）を回帰検出したい。今は spike の手動検証のみ |
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
| F37 | feature | Diff | ブランチの base からの差分を表示する | 複数コミットある時に全体の差分をエディタ上で確認したい |
| F5 | feature | Diff | 右端スクロール領域に差分位置マーカーを出す | minimap 的な把握用 |
| F7 | feature | Terminal | ファイル名が改行を跨いでもリンクできるようにする | linkifier 改善 |
| F8 | feature | Terminal | ファイルクリック時にツリー側も開く | navigation の連動 |
| F9 | feature | Terminal | ウィンドウを広げた時に 1 行の文字数を増やす | xterm fit を調整 |
| F25 | feature | Updates | Yuru の更新通知を出す | ローカル build 運用だと更新に気づきにくい |
| F33 | feature | App Runtime | 起動元ごとに `start/stop/restart` できるようにする | 複数起動時に別の Yuru を巻き込まないようにしたい |
| F36 | feature | Repos | `yuru add` の結果を実行中の画面に反映する | 詳細: docs/backlog-details/F36-yuru-add-refresh.md |
| B7 | bug | Worktrees | repo 内の `.yuru` ディレクトリをやめる | 既存プロダクトは `.yuru` を ignore していないため、Yuru 利用だけで未追跡ファイルが出る |
| F32 | feature | Terminal | task worktree 外の作業を standalone terminal として分離する | task worktree list に混ぜない補助導線として欲しい |
| I10 | investigate | Files | 自前 tree で大量のファイルを表示した時の重さ対策を考える | 切り替え後に実測して判断したい |
| I14 | investigate | Persistence | metadata が壊れていた時の救済を考える | 単一ファイルの一部破損で全体が読めなくなるため |
| I15 | investigate | IPC | `electronAPI` と IPC channel の対応を追いやすくする | renderer / preload / main で名前がズレていて読みにくいため、channel 名を露出するか shared RPC wrapper に寄せるか決めたい |
| I16 | investigate | Events | backend event の発火ポリシーと購読設計を整理する | frontend 起点 IPC の応答代わりに push すると race しやすいため、外部変化・非同期完了・プロセス終了などに用途を限定したい |
| I17 | investigate | Dependencies | `rg` 依存を見直す | provider store の検索で暗黙に使っているため、Codex 同梱 / Homebrew / GUI 起動時 PATH のどれを前提にするか整理したい |
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

## Won't support

このツールは作者個人のためのもので、作者の利用範囲から外れる用途はサポートしない。

- macOS 以外のプラットフォーム（Windows / Linux）
- Claude / Codex 以外のエージェント
- 外付けボリューム上での使用
