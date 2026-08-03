# Backlog

Last updated: 2026-08-07

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
| P18 | polish | Changes | Changes のファイル表示順を最適化する | 確認したい変更へ素早くたどり着けるようにしたい |
| F7 | feature | Terminal | ファイル名が改行を跨いでもリンクできるようにする | linkifier 改善 |
| F51 | feature | Files / Persistence | worktree ごとに開いていたファイルを覚えておく | worktree を切り替えて戻った時に、直前のファイルから作業を再開したい。詳細: docs/backlog-details/F51-worktree-keep-alive.md |
| P22 | polish | App / Sessions | worktree の表示データを App の一括配布から worktreeId 単位の取得・購読に変える | SessionView が worktree オブジェクトを props で受け取っており、session の push 1 件で無関係な表示まで再描画が波及する。F51 の keep-alive で instance が増えると影響が拡大する。詳細: docs/backlog-details/P22-worktree-data-subscription.md |
| F54 | feature | Changes | ショートカットキーでレビュー済みにできるようにする | ファイルレビューを素早く進めたい |
| I21 | investigate | Sessions | primary session の体験を見直す | 詳細: docs/backlog-details/I21-primary-session-experience.md |

## Next

| ID | Type | Area | Item | Notes |
|---|---|---|---|---|
| F55 | feature | Mobile | モバイル連携 | モバイルから Yuru を使えるようにしたい |
| F48 | feature | Worktrees | 分岐した作業のために新しい task worktree を作成できるようにする | 現在の作業を残したまま別案や別タスクを進めたい。詳細: docs/backlog-details/F48-branch-work.md |
| F49 | feature | Updates | UI から `yuru latest` を実行できるようにする | ターミナルを開かずに Yuru を最新版へ更新したい |
| F50 | feature | Files | 変更ファイルだけをツリー表示できるようにする | 変更箇所に絞ってファイルを確認したい |
| F46 | feature | Repos | リポジトリを管理対象から削除できるようにする | `yuru add` と対になる機能として欲しい |
| P9 | polish | New Session | 長い repo path の省略ルールを見直す | 折りたたみが不自然 |
| P16 | polish | Worktrees / Changes | 左ペインで worktree の Git 変更状態を分かるようにする | いま選択していない worktree に unstaged/staged/untracked 変更があることに気づけない |
| F8 | feature | Terminal | ファイルクリック時にツリー側も開く | navigation の連動 |
| F9 | feature | Terminal | ウィンドウを広げた時に 1 行の文字数を増やす | xterm fit を調整 |
| F25 | feature | Updates | Yuru の更新通知を出す | ローカル build 運用だと更新に気づきにくい |
| F33 | feature | App Runtime | 起動元ごとに `start/stop/restart` できるようにする | 複数起動時に別の Yuru を巻き込まないようにしたい |
| F36 | feature | Repos | `yuru add` の結果を実行中の画面に反映する | 詳細: docs/backlog-details/F36-yuru-add-refresh.md |
| F40 | feature | Files / Editor | ファイルを埋め込みエディタで編集できるようにする (編集モード) | 詳細: docs/backlog-details/F40-edit-mode.md |
| B7 | bug | Worktrees / Git | repo 内の `/.yuru/` を Git の local exclude に登録する | tracked な `.gitignore` は変更せず、Yuru の worktree が未追跡表示や `git add .` の対象になることを防ぐ |
| B8 | bug | Sessions | claude で `/clear` するとセッションが迷子になる | 詳細: docs/backlog-details/B8-clear-session-lost.md |
| B12 | bug | Sessions / Worktree Context | Claude の resume で worktree の作業指示が引き継がれない | `--append-system-prompt` の指示が保存されないため、resume すると Claude が repo root で作業してしまう。詳細: docs/backlog-details/B12-resume-worktree-context.md |
| I15 | investigate | IPC | `electronAPI` と IPC channel の対応を追いやすくする | renderer / preload / main で名前がズレていて読みにくいため、channel 名を露出するか shared RPC wrapper に寄せるか決めたい |
| I16 | investigate | Events | backend event の発火ポリシーと購読設計を整理する | frontend 起点 IPC の応答代わりに push すると race しやすいため、外部変化・非同期完了・プロセス終了などに用途を限定したい |
| F28 | feature | Files | ファイル検索の最近開いたファイル履歴 | Cmd+P 空入力時に履歴を出したい |
| I11 | investigate | App | モーダルとショートカットの管理設計を決める (詳細: docs/backlog-details/I11-modal-management.md) | FileSearch 導入時に Cmd+P が他モーダル裏で発火する問題が出たため、場当たり対応せず設計として直したい |
| P17 | polish | Repos / Sessions | getRepos が毎回全セッションのログを読むのをやめる | 一覧は ID と並び順程度に痩せさせ、プレビュー等のセッション表示状態はカード側が個別に取得する。session:changed push の続きで、将来のカード単位購読にも繋がる |
| F56 | feature | Sessions / Review | 別の agent に会話コンテキスト付きでレビューを依頼しやすくする | 実装時の会話にある要件・確認済みの事実・設計判断を、別 provider のレビューへ簡単に引き継ぎたい。詳細: docs/backlog-details/F56-conversation-context-review.md |
| P21 | polish | App | UI をクリックした時のインタラクションを全体的に見直す | 詳細: docs/backlog-details/P21-ui-click-interaction.md |
| B13 | bug | Sessions / Providers | kimi のセッションを開いただけで作業が発生してトークンを消費する | 起動時の指示に agent が反応して初期調査を始めてしまうと思われる |
| F57 | feature | Files / Preview | HTML プレビューを手動でリロードできるようにする | CSS/JS 単独の変更は entry の content が変わらないと iframe が再読み込みされず表示に反映されない。現状は表示モードの切り替えで再マウントさせるしかない |

## Later

| ID | Type | Area | Item | Notes |
|---|---|---|---|---|
| F47 | feature | GitHub / Worktrees | PR を取り込んで task worktree を作成できるようにする | 自分が reviewer になっている PR から選ぶ、fork PR (`refs/pull/<n>/head`) の取り込みなどの拡張。remote branch の取り込み (F42、詳細: docs/backlog-details/F42-remote-branch-worktree.md) で当面カバーできるため Later |
| F10 | feature | Terminal | ターミナル内文字列検索 | 独立機能として実装したい |
| F12 | feature | Diff | Split mode | 面積と複雑さが増える |
| F13 | feature | Files / Code | 選択範囲をターミナルに貼り付ける | editor と terminal の連携が必要 |
| F39 | feature | Search | 検索結果を streaming 表示する | F15 初期実装では検索完了後にまとめて表示する。巨大 repo で初回結果の待ち時間が気になったら欲しい |
| I8 | investigate | Dependencies | 依存更新の安全運用を決める | minimum release age や通知方針を整理したい |
| I20 | investigate | Workspace | repo ではない作業場所のサポート | 現在は Git repo 前提が強いため、standalone terminal / Files / Changes の扱いを分けて設計する |

## Open decisions

- (なし)

## Won't support

このツールは作者個人のためのもので、作者の利用範囲から外れる用途はサポートしない。

- macOS 以外のプラットフォーム（Windows / Linux）
- Claude / Codex / Kimi 以外のエージェント
- 外付けボリューム上での使用
- bare repository
- UTF-8 以外の文字コードで書かれたファイル
