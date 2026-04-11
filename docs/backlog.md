# Backlog

Last updated: 2026-04-12

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
| F21 | feature | App | メニュー整理。タイトルが `Electron` になっている問題を直す | アプリ全体の完成度に直結する |
| F20 | feature | App | アプリのアイコンを付ける | テンションとプロダクト感を上げたい |
| F22 | feature | CLI | `yuru` コマンドで起動できるようにする | 使い始めるまでの摩擦を下げたい |
| I1 | investigate | Sessions | `Remove worktree` 失敗時に未コミット・未追跡ファイルをどう扱うか決める | 削除 UX の設計に必要 |
| B1 | bug | Archived | Archived セクションの表示崩れを直す | 明確な UI バグ |
| B3 | bug | Sessions | 古いセッション選択時の `No conversation found with ID: ...` のちらつきを消す | 誤解を生む |
| P11 | polish | Sessions | 最新会話プレビューが一覧に同期されない問題を直す | 一覧の情報鮮度が低い |
| B5 | bug | New Session | hover ハイライトが `WT` の手前で不自然に切れる問題を直す | 明確な UI バグ |
| I2 | investigate | Sessions | Claude と Codex のセッション一覧 merge ロジックに無理がないか確認する | 表示改善前に土台確認したい |

## Next

| ID | Type | Area | Item | Notes |
|---|---|---|---|---|
| F16 | feature | GitHub | セッションカードに PR の有無と状態を表示する | GitHub 連携として早めに価値が出そう |
| F17 | feature | GitHub | PR へのリンクを出す | そこそこ早めに欲しくなりそう |
| F1 | feature | Notifications | 並列実行セッションの完了通知を出す | 完了に気づけない |
| P7 | polish | New Session | `WT` 表示を置き換える | 文言かアイコンかを再検討 |
| P8 | polish | New Session | Claude / Codex のアイコンを出す | Sessions 側とトーンを揃えたい |
| P9 | polish | New Session | 長い repo path の省略ルールを見直す | 折りたたみが不自然 |
| F3 | feature | Changes | 変更行数も出す | diff 集計で対応したい |
| F4 | feature | Diff | 各ファイルの変更行数表示 | Changes と整合させたい |
| F5 | feature | Diff | 右端スクロール領域に差分位置マーカーを出す | minimap 的な把握用 |
| F6 | feature | Files / Code | 追加・削除・更新された行を示す | diff 情報の再利用を想定 |
| F7 | feature | Terminal | ファイル名が改行を跨いでもリンクできるようにする | linkifier 改善 |
| F8 | feature | Terminal | ファイルクリック時にツリー側も開く | navigation の連動 |
| F9 | feature | Terminal | ウィンドウを広げた時に 1 行の文字数を増やす | xterm fit を調整 |
| I3 | feature | App Runtime | 起動元ごとに `start/stop/restart` できるようにする | 複数起動時に別の Yuru を巻き込まないようにしたい |
| I4 | feature | Persistence | Yuru の状態を永続化できるようにする | 何をどこに持つかを実装可能な形にしたい |
| I5 | feature | Persistence | dev / prd で保存先を分ける | 開発版の状態が本番に影響しないようにしたい |

## Later

| ID | Type | Area | Item | Notes |
|---|---|---|---|---|
| F10 | feature | Terminal | ターミナル内文字列検索 | 独立機能として実装したい |
| F11 | feature | Diff | ファイル単位の既読管理 | 状態設計が必要 |
| F12 | feature | Diff | Split mode | 面積と複雑さが増える |
| F13 | feature | Files / Code | 選択範囲をターミナルに貼り付ける | editor と terminal の連携が必要 |
| F14 | feature | Files | ファイル名検索 | ツリー設計と一緒に考えたい |
| F15 | feature | Search | ファイル横断検索 | 別機能として扱いたい |
| F18 | feature | GitHub | PR マージ時に worktree を自動整理する | 自動 archived までつなげたい |
| F24 | feature | Empty state | 空画面から新規セッションを始められるようにする | あると親切だが、今すぐではない |
| I6 | investigate | Codex / Sessions | Codex self-update 後のセッション終了 UX を見直す | 日常的ではないが、消えたように見えると驚きやすい |

## Open decisions

- `Remove worktree` 失敗時は `--force` を提案するだけにするか、明示的な force 削除フローを持つか
- 変更ファイル数・変更行数の集計は都度計算かキャッシュか
