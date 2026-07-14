# Backlog

Last updated: 2026-07-15

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
| F42 | feature | Worktrees | remote branch から task worktree を作れるようにする | 他人や別環境で作った branch を Yuru の作業単位として開きたい |
| F11 | feature | Diff | GitHub review のようにファイルごとに差分を確認済みにできるようにする | 大きめの差分で、どのファイルを見終わったかを失わずに確認したい |
| F37 | feature | Diff | ブランチの任意のコミット間で diff を表示できるようにする | 複数コミットある作業で差分の範囲を切り替えて確認したい |

## Next

| ID | Type | Area | Item | Notes |
|---|---|---|---|---|
| F43 | feature | Worktrees / Terminal | worktree の作成・選択と session の操作を分離する | 詳細: docs/backlog-details/F43-worktree-session-responsibilities.md |
| F44 | feature | Sessions / Terminal | primary session と worktree の紐付けを解除できるようにする | F43 完了後。worktree と session 履歴は残し、別 provider へ引き継げるようにする |
| I18 | investigate | Events / Worktree Context | worktree 表示情報の更新タイミングを matrix で整理する | 詳細: docs/backlog-details/I18-worktree-refresh-policy.md |
| F32 | feature | Terminal | task worktree 外の作業を standalone terminal として分離する | task worktree list に混ぜない補助導線として欲しい |
| P9 | polish | New Session | 長い repo path の省略ルールを見直す | 折りたたみが不自然 |
| P13 | polish | Files | Files タブのアクション UI を整える | 階層感が弱く見た目もまだ野暮ったい |
| P16 | polish | Worktrees / Changes | 左ペインで worktree の Git 変更状態を分かるようにする | いま選択していない worktree に unstaged/staged/untracked 変更があることに気づけない |
| F7 | feature | Terminal | ファイル名が改行を跨いでもリンクできるようにする | linkifier 改善 |
| F8 | feature | Terminal | ファイルクリック時にツリー側も開く | navigation の連動 |
| F9 | feature | Terminal | ウィンドウを広げた時に 1 行の文字数を増やす | xterm fit を調整 |
| F25 | feature | Updates | Yuru の更新通知を出す | ローカル build 運用だと更新に気づきにくい |
| F33 | feature | App Runtime | 起動元ごとに `start/stop/restart` できるようにする | 複数起動時に別の Yuru を巻き込まないようにしたい |
| F36 | feature | Repos | `yuru add` の結果を実行中の画面に反映する | 詳細: docs/backlog-details/F36-yuru-add-refresh.md |
| F40 | feature | Files / Editor | ファイルを埋め込みエディタで編集できるようにする (編集モード) | 詳細: docs/backlog-details/F40-edit-mode.md |
| B7 | bug | Worktrees / Git | repo 内の `/.yuru/` を Git の local exclude に登録する | tracked な `.gitignore` は変更せず、Yuru の worktree が未追跡表示や `git add .` の対象になることを防ぐ |
| B8 | bug | Sessions | claude で `/clear` するとセッションが迷子になる | 詳細: docs/backlog-details/B8-clear-session-lost.md |
| I10 | investigate | Files | 自前 tree で大量のファイルを表示した時の重さ対策を考える | 切り替え後に実測して判断したい |
| I14 | investigate | Persistence | metadata が壊れていた時の救済を考える | 単一ファイルの一部破損で全体が読めなくなるため |
| I15 | investigate | IPC | `electronAPI` と IPC channel の対応を追いやすくする | renderer / preload / main で名前がズレていて読みにくいため、channel 名を露出するか shared RPC wrapper に寄せるか決めたい |
| I16 | investigate | Events | backend event の発火ポリシーと購読設計を整理する | frontend 起点 IPC の応答代わりに push すると race しやすいため、外部変化・非同期完了・プロセス終了などに用途を限定したい |
| I17 | investigate | Dependencies | `rg` 依存を見直す | provider store の検索で暗黙に使っているため、Codex 同梱 / Homebrew / GUI 起動時 PATH のどれを前提にするか整理したい |
| F28 | feature | Files | ファイル検索の最近開いたファイル履歴 | Cmd+P 空入力時に履歴を出したい |
| I11 | investigate | App | モーダルとショートカットの管理設計を決める (詳細: docs/backlog-details/I11-modal-management.md) | FileSearch 導入時に Cmd+P が他モーダル裏で発火する問題が出たため、場当たり対応せず設計として直したい |
| P17 | polish | Repos / Sessions | getRepos が毎回全セッションのログを読むのをやめる | 一覧は ID と並び順程度に痩せさせ、プレビュー等のセッション表示状態はカード側が個別に取得する。session:changed push の続きで、将来のカード単位購読にも繋がる |

## Later

| ID | Type | Area | Item | Notes |
|---|---|---|---|---|
| B3 | bug | Sessions | 古いセッション選択時の `No conversation found with ID: ...` のちらつきを消す | 誤解を生む |
| F10 | feature | Terminal | ターミナル内文字列検索 | 独立機能として実装したい |
| F12 | feature | Diff | Split mode | 面積と複雑さが増える |
| F13 | feature | Files / Code | 選択範囲をターミナルに貼り付ける | editor と terminal の連携が必要 |
| F18 | feature | GitHub | PR マージ時に worktree を自動整理する | 自動 archived までつなげたい |
| F24 | feature | Empty state | 空画面から新規セッションを始められるようにする | あると親切だが、今すぐではない |
| F39 | feature | Search | 検索結果を streaming 表示する | F15 初期実装では検索完了後にまとめて表示する。巨大 repo で初回結果の待ち時間が気になったら欲しい |
| I6 | investigate | Sessions / Terminal | セッション終了時メッセージの表示保持を見直す | 終了直前の案内や要約をその場で読めないと戸惑いやすい |
| I7 | investigate | Sessions / Persistence | セッション終了メッセージの再到達性をどう担保するか決める | あとから確認できる保証がないと次の操作で迷いやすい |
| I8 | investigate | Dependencies | 依存更新の安全運用を決める | minimum release age や通知方針を整理したい |
| I20 | investigate | Workspace | repo ではない作業場所のサポート | 現在は Git repo 前提が強いため、standalone terminal / Files / Changes の扱いを分けて設計する |
| B9 | bug | App Runtime / Build | 起動中の画面が参照する動的 import chunk を再ビルドで消さない | Reload で復旧でき、PTY も継続するため低優先。詳細: docs/backlog-details/B9-stale-dynamic-import.md |

## Open decisions

- (なし)

## Won't support

このツールは作者個人のためのもので、作者の利用範囲から外れる用途はサポートしない。

- macOS 以外のプラットフォーム（Windows / Linux）
- Claude / Codex 以外のエージェント
- 外付けボリューム上での使用
- bare repository
- UTF-8 以外の文字コードで書かれたファイル
