# Backlog

Last updated: 2026-09-03

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
| P22 | polish | App / Sessions | worktree の表示データを App の一括配布から worktreeId 単位の取得・購読に変える | WorktreeView が worktree オブジェクトを props で受け取っており、session の push 1 件で無関係な表示まで再描画が波及する。F51 の keep-alive で instance が増えると影響が拡大する。詳細: docs/backlog-details/P22-worktree-data-subscription.md |
| B12 | bug | Sessions / Worktree Context | Claude の resume で worktree の作業指示が引き継がれない | `--append-system-prompt` の指示が保存されないため、resume すると Claude が repo root で作業してしまう。詳細: docs/backlog-details/B12-resume-worktree-context.md |
| B15 | bug | Terminal | ターミナルにフォーカスできないことがある | キーボード入力を始められないことがある |
| B16 | bug | Changes / Diff | Committed の diff を正確にする | commit 済みの変更を正しい差分でレビューしたい |
| F72 | feature | Files / Blame | GitLens みたいな blame 表示機能 | コードの各行が変更された経緯をファイル表示から確認したい |
| F74 | feature | Terminal / Bookmarks | Terminal に表示されている PR のクリック時にもブックマークに登録する | Terminal から開いた PR を worktree の関連情報として残したい |
| F75 | feature | Terminal / GitHub | Terminal の `#NNNN` から GitHub の Issue / PR にリンクする | Issue / PR 番号から対象をすぐに開きたい |
| F76 | feature | Terminal / Bookmarks | Terminal の `#NNNN` のクリック時にもブックマークに登録する | 番号リンクから開いた Issue / PR も worktree の関連情報として残したい |
| F77 | feature | Worktrees / Bookmarks | ブックマークが GitHub の Issue / PR ならステータスも表示する | 関連する Issue / PR の状態をブックマーク一覧で把握したい |

## Next

| ID | Type | Area | Item | Notes |
|---|---|---|---|---|
| B17 | bug | Files / Preview | Markdown プレビューで追加と削除が混ざっていても緑で表示されてしまう | Markdown の差分で追加と削除を正しく見分けたい |
| B18 | bug | Files / Edit | 編集モードで閲覧中に更新された内容が反映されない | 外部で更新されたファイルの最新内容を編集モードでも確認したい |
| F73 | investigate | Worktrees / Bookmarks | 自動ブックマーク（会話ログからの URL 自動追加）を残すか消すか判断する | URL クリック登録の体験を見て判断。`YURU_BOOKMARK_AUTO_CAPTURE=1` で有効化できる。詳細: docs/backlog-details/F71-bookmarks.md |
| P18 | polish | Changes | Changes のファイル表示順を最適化する | 確認したい変更へ素早くたどり着けるようにしたい |
| P25 | polish | Home | ホーム画面のスタイルを改善する | 最初に目に入る画面の見た目を整えたい |
| F69 | feature | API / Sessions | API でセッション作成時に effort レベルを設定できるようにする | セッションの用途に応じて推論量を指定したい |
| F68 | feature | Sessions / Rate Limits | もうすぐ 100% になる時にあらかじめ rate limit 解除を予約したい | rate limit に達した後の待ち時間を減らしたい |
| F54 | feature | Changes | ショートカットキーでレビュー済みにできるようにする | ファイルレビューを素早く進めたい |
| F55 | feature | Mobile | モバイル連携 | モバイルから Yuru を使えるようにしたい |
| F49 | feature | Updates | UI から `yuru latest` を実行できるようにする | ターミナルを開かずに Yuru を最新版へ更新したい |
| F50 | feature | Files | 変更ファイルだけをツリー表示できるようにする | 変更箇所に絞ってファイルを確認したい |
| F46 | feature | Repos | リポジトリを管理対象から削除できるようにする | `yuru add` と対になる機能として欲しい |
| P9 | polish | New Session | 長い repo path の省略ルールを見直す | 折りたたみが不自然 |
| P16 | polish | Worktrees / Changes | 左ペインで worktree の Git 変更状態を分かるようにする | いま選択していない worktree に unstaged/staged/untracked 変更があることに気づけない |
| F9 | feature | Terminal | ウィンドウを広げた時に 1 行の文字数を増やす | xterm fit を調整 |
| F25 | feature | Updates | Yuru の更新通知を出す | ローカル build 運用だと更新に気づきにくい |
| I15 | investigate | IPC | `electronAPI` と IPC channel の対応を追いやすくする | renderer / preload / main で名前がズレていて読みにくいため、channel 名を露出するか shared RPC wrapper に寄せるか決めたい |
| I16 | investigate | Events | backend event の発火ポリシーと購読設計を整理する | frontend 起点 IPC の応答代わりに push すると race しやすいため、外部変化・非同期完了・プロセス終了などに用途を限定したい |
| I11 | investigate | App | モーダルとショートカットの管理設計を決める (詳細: docs/backlog-details/I11-modal-management.md) | FileSearch 導入時に Cmd+P が他モーダル裏で発火する問題が出たため、場当たり対応せず設計として直したい |
| P17 | polish | Repos / Sessions | getRepos が毎回全セッションのログを読むのをやめる | 一覧は ID と並び順程度に痩せさせ、プレビュー等のセッション表示状態はカード側が個別に取得する。session:changed push の続きで、将来のカード単位購読にも繋がる。I21 の「選択中セッションをカードに出す」拡張の前提でもある |
| P27 | polish | Sessions / Codex | Codex で削除済みの raw rollout を Yuru の対象から除外する | 現在のデータソースに沿った挙動だが、削除済みセッションを preview・worktree 検出の解析対象から除外すれば不要な解析を減らせる |
| P26 | polish | Files / Search | Preview / View / Edit の切り替えでファイル内検索を引き継ぐ | 同じファイルをモード間で見比べる時、検索バーの開閉状態と検索語が失われないようにしたい |
| P21 | polish | App | UI をクリックした時のインタラクションを全体的に見直す | 詳細: docs/backlog-details/P21-ui-click-interaction.md |
| F57 | feature | Files / Preview | HTML プレビューを手動でリロードできるようにする | CSS/JS 単独の変更は entry の content が変わらないと iframe が再読み込みされず表示に反映されない。現状は表示モードの切り替えで再マウントさせるしかない |
| F12 | feature | Diff | Split mode | 面積と複雑さが増える |
| I22 | investigate | Main Worktree | main worktree の UX を考え直す | main worktree の使い方に合う操作と表示を整理したい |

## Later

| ID | Type | Area | Item | Notes |
|---|---|---|---|---|
| F10 | feature | Terminal | ターミナル内文字列検索 | 独立機能として実装したい |
| F13 | feature | Files / Code | 選択範囲をターミナルに貼り付ける | editor と terminal の連携が必要 |
| F39 | feature | Search | 検索結果を streaming 表示する | F15 初期実装では検索完了後にまとめて表示する。巨大 repo で初回結果の待ち時間が気になったら欲しい |
| P23 | polish | Files / Preview | diff パネルが表示している内容を 1 つの取得経路にまとめる | 差分テキストと画像で loader も state も別々にあり、表示中の内容を指す共通の識別子がない。今は取得契機と間隔をそろえて実害を消しているだけなので、片方だけ追従が漏れると「見ていない内容を Reviewed にできる」形の不整合が再発しうる |
| P24 | polish | Sessions / Providers | Codex CLI 0.147 未満のログ形式 (exec_command function_call / patch_apply_end) 向けの後方互換パーサを削除する | 2026-09-11 以降に `~/.codex/sessions` を再確認し、旧形式が1ヶ月出現していなければ削除可。確認方法込みで詳細: docs/backlog-details/P24-remove-legacy-codex-exec-format.md |
| F62 | feature | Worktrees / Terminal | worktree でターミナルを使えるようにする | エージェントのセッションとは別にコマンドを実行したい |
| F36 | feature | Repos | `yuru add` の結果を実行中の画面に反映する | 詳細: docs/backlog-details/F36-yuru-add-refresh.md |

## Open decisions

- (なし)

## Won't support

このツールは作者個人のためのもので、作者の利用範囲から外れる用途はサポートしない。

- macOS 以外のプラットフォーム（Windows / Linux）
- Claude / Codex / Kimi 以外のエージェント
- 外付けボリューム上での使用
- bare repository
- UTF-8 以外の文字コードで書かれたファイル
