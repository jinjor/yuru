# Backlog

Last updated: 2026-04-09

Yuru の backlog。
UI 改善も機能追加も同じ土俵で扱う。
ここでは「次に何をやるか」を管理し、実装の細部や現状の正しさはコードを読む前提にする。

## How to read this

- `Type`: `bug`, `polish`, `feature`, `investigate`
- `Now`: 先に片付けたいもの
- `Next`: 使用感を押し上げるもの
- `Later`: 後でまとめて設計したいもの

## Now

| ID | Type | Area | Item | Why now |
|---|---|---|---|---|
| B1 | bug | Archived | Archived セクションの表示崩れを直す | 明確な UI バグ |
| B2 | bug | Empty state | 空画面から新規セッションを始められるようにする | 次の行動が取れない |
| B3 | bug | Sessions | 古いセッション選択時の `No conversation found with ID: ...` のちらつきを消す | 誤解を生む |
| B4 | bug | Sessions | 最新会話プレビューが一覧に同期されない問題を直す | 一覧の情報鮮度が低い |
| B5 | bug | New Session | hover ハイライトが `WT` の手前で不自然に切れる問題を直す | 明確な UI バグ |
| P1 | polish | Sessions | `Remove worktree` の導線を見直す。常設の赤ボタンをやめる | 誤操作リスクが高い |
| P2 | polish | Sessions | active にすると `Remove worktree` が消える不自然さをなくす | 状態遷移が読みにくい |
| P3 | polish | Sessions | worktree セッションを `repo / worktree / branch` として把握しやすくする | 今の情報設計が弱い |
| I1 | investigate | Sessions | `Remove worktree` 失敗時に未コミット・未追跡ファイルをどう扱うか決める | force 削除の UX 判断が必要 |
| I2 | investigate | Sessions | Claude と Codex のセッション一覧 merge ロジックに無理がないか確認する | 表示改善前に土台確認したい |

## Next

| ID | Type | Area | Item | Notes |
|---|---|---|---|---|
| P4 | polish | Sessions | `CODEX` / `CLAUDE` 表示を小さくする。badge より icon 寄りにしたい | provider の主張が強すぎる |
| P5 | polish | Sessions | inactive セッションをもっと薄くする | active とのコントラスト改善 |
| P6 | polish | Sessions | worktree / branch / git のアイコン整理 | 情報の読み取りを速くしたい |
| F1 | feature | Notifications | 並列実行セッションの完了通知を出す | 完了に気づけない |
| P7 | polish | New Session | `WT` 表示を置き換える | 文言かアイコンかを再検討 |
| P8 | polish | New Session | Claude / Codex のアイコンを出す | provider の識別改善 |
| P9 | polish | New Session | 長い repo path の省略ルールを見直す | 折りたたみが不自然 |
| F2 | feature | Changes | 変更ファイル数を出す | タブラベル候補 |
| F3 | feature | Changes | 変更行数も出す | diff 集計で対応したい |
| F4 | feature | Diff | 各ファイルの変更行数表示 | Changes と整合させたい |
| F5 | feature | Diff | 右端スクロール領域に差分位置マーカーを出す | minimap 的な把握用 |
| F6 | feature | Files / Code | 追加・削除・更新された行を示す | diff 情報の再利用を想定 |
| F7 | feature | Terminal | ファイル名が改行を跨いでもリンクできるようにする | linkifier 改善 |
| F8 | feature | Terminal | ファイルクリック時にツリー側も開く | navigation の連動 |
| F9 | feature | Terminal | ウィンドウを広げた時に 1 行の文字数を増やす | xterm fit を調整 |

## Later

| ID | Type | Area | Item | Notes |
|---|---|---|---|---|
| F10 | feature | Terminal | ターミナル内文字列検索 | 独立機能として実装したい |
| F11 | feature | Diff | ファイル単位の既読管理 | 状態設計が必要 |
| F12 | feature | Diff | Split mode | 面積と複雑さが増える |
| F13 | feature | Files / Code | 選択範囲をターミナルに貼り付ける | editor と terminal の連携が必要 |
| F14 | feature | Files | ファイル名検索 | ツリー設計と一緒に考えたい |
| F15 | feature | Search | ファイル横断検索 | 別機能として扱いたい |
| F16 | feature | GitHub | セッションカードに PR の有無と状態を表示する | open / merged / closed を出したい |
| F17 | feature | GitHub | PR へのリンクを出す | session と branch の紐づき活用 |
| F18 | feature | GitHub | PR マージ時に worktree を自動整理する | 自動 archived までつなげたい |
| F19 | feature | GitHub | branch から PR を作るショートカットを出す | worktree workflow を短くしたい |
| F20 | feature | App | アプリのアイコンを付ける | branding |
| F21 | feature | App | メニュー整理。タイトルが `Electron` になっている問題を直す | 仕上げ |
| F22 | feature | CLI | `yuru` コマンドで起動できるようにする | 配布導線 |
| F23 | feature | State | Yuru 独自の UI 状態保存を導入する | 列幅、最後の選択など |

## Current focus

最初の 1 セットはこれでよさそう。

1. Archived 崩れ修正
2. empty state から新規セッション開始
3. `Remove worktree` の導線見直し
4. セッションカードの `repo / worktree / branch` 表示整理

## Open decisions

- Claude / Codex の公式ロゴやアイコンをそのまま使ってよいか
- `Remove worktree` 失敗時は `--force` を提案するだけにするか、明示的な force 削除フローを持つか
- 変更ファイル数・変更行数の集計は都度計算かキャッシュか
