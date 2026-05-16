# F15 Code Search

Last updated: 2026-05-17

`F15` は、選択中の task worktree の中だけを対象にコード検索する機能。

## Goal

- 選択中の task worktree 全体から文字列をすばやく探せる
- 検索結果から該当ファイル・該当行に直接移動できる
- 巨大モノレポでの普段使いに耐える検索体験にする

## Required premise

検索対象は **選択中の task worktree のみ** に固定する。

これは制約ではなく、Yuru の中心的な価値である。
AI コーディング中は複数 worktree が同時に存在するため、検索が別 worktree を跨ぐと「今どの作業場所を見ているか」が崩れる。
登録済み repo 全体、全 task worktree、main worktree、他 provider session の cwd は検索対象にしない。

実装上も、検索 process の cwd は選択中 task worktree の `worktreePath` にする。

## Decisions

- 検索 engine は index なしの `rg` ベースで始める
- 検索 UI は `Explorer` / `Diff` と同じ領域に、新しい `Search` panel として追加する
- keybinding は `Cmd+Shift+F`
- 初期状態は plain text search にする
- 結果数 limit は設ける
  - 具体的な数は実装時に決める
- 初期実装では検索完了後にまとめて結果を返す
  - 逐次 push / streaming 表示は別 backlog item として扱う
- `rg` の入手経路は `I17` で扱う

## Target behavior

- `Terminal` / `Files` / `Changes` と同じく、選択中 task worktree に連動する
- 検索 UI は `Explorer` / `Diff` と同じ領域に置く
- 検索 UI は入力欄と結果リストを中心にする
- `Cmd+Shift+F` で `Search` panel を開く、または focus する
- 結果はファイルごとにまとまり、行番号、該当行、match highlight を表示する
- 結果を選択すると `SourceViewer` でそのファイルを開き、該当行へ移動する
- 入力中は debounce して検索する
- 新しい検索が始まったら前の検索 process はキャンセルする
- 結果数には上限を設ける
- 検索失敗時は明示的な error として扱う

## Search engine

初期実装では `rg` に任せる。
自前 index は作らない。

理由:

- VS Code も workspace search の土台として ripgrep を使っている
- ripgrep は `.gitignore` / `.ignore` / `.rgignore`、hidden file、binary file の扱いがコード検索向け
- Yuru はローカルの選択中 worktree だけを検索するため、GitHub Code Search や Sourcegraph のような常時 index はまず不要

実装では `rg --json` を使い、stdout を構造化データとして parse する。
表示用の文字列を ad hoc に分解しない。
plain text search では `--fixed-strings` を使う。

`rg` が見つからない場合は、勝手に遅い fallback を実装しない。
`rg` が必要であることを error として表示する。
ただし `rg` を Yuru に同梱するか、ユーザーの PATH に依存するかは `I17` で決める。

## Practicality notes

この repo はまだ小さい。

- `rg --files`: 107 files
- `rg --files` 対象の合計サイズ: 約 1.1 MiB
- `rg --count-matches "worktree"`: 約 0.01s
- `rg --count-matches "__definitely_no_such_yuru_token__"`: 約 0.01s

単純に 500 倍すると、約 53,500 files / 約 554 MiB になる。
この repo の実測 0.01s は小さすぎて線形見積もりには使いにくい。

同じ環境で `node_modules` も雑に測ると、約 13,325 files / 約 501 MiB に対して:

- no-match 検索: 約 0.45s
- match の多い `function` 検索: 約 0.45s

ただしこれは依存パッケージの集合であり、実際の巨大モノレポとはファイルサイズ分布も ignore 設定も違う。
現時点の見立てとしては、500 倍程度のローカル worktree なら、単純な文字列検索は十分実用的な可能性が高い。
一方で、次の条件では体感が悪くなりうる。

- cold cache
- match が多すぎて UI へ流す結果が膨らむ
- 長すぎる行
- literal optimization が効きにくい regex
- symlink を大量に辿る設定
- ignore されていない生成物や vendor directory

F15 実装前に、実際に使いたい巨大モノレポで `rg` のベンチを取る。
初期の目安は「単純な literal 検索が 1 秒前後、重めでも数秒以内」。
これを大きく外れるなら include / exclude UI を早めるか、index を再検討する。

## UI shape

初期 UI:

- 検索入力
- 検索状態
- ファイルごとに grouped された結果
- 行番号
- 該当行 preview
- match highlight
- 選択中結果の keyboard navigation

近い将来ほぼ欲しくなるもの:

- 最近の検索履歴
- include / exclude UI
- VS Code の `search.exclude` 相当
- case sensitive / whole word / regex toggle

最初から入れないもの:

- replace
- semantic search
- symbol search
- task worktree 横断検索
- repo 横断検索
- search index
- result streaming

## Reference notes

有名エディタ・検索サービスの実装は大きく 2 系統に分かれる。

- VS Code は search / quick open に ripgrep を使っている。`@vscode/ripgrep` は platform ごとの rg binary を npm package として解決する仕組みを持つ。
- JetBrains IDE は Find in Files に scope、file mask、結果 tool window などを持ち、基盤として file-based index / word index / filename index などを持つ。
- Sublime Text は symbol / completion 用の index を持ち、Find in Files でも file pattern による include / exclude が重要な UI になっている。
- Zed は project search を自前実装しており、ripgrep と比較しながら throughput より first result latency を改善している。
- GitHub Code Search や Sourcegraph / Zoekt は、複数 repo や巨大 corpus を高速に検索するために trigram / n-gram 系の index を使う。これは Yuru の初期範囲より大きい問題。

Yuru の初期実装は VS Code に近い。
ただし VS Code と違い、workspace ではなく選択中 task worktree だけを検索対象にする。

参考:

- VS Code Search Issues: https://github.com/microsoft/vscode/wiki/Search-Issues
- `@vscode/ripgrep`: https://github.com/microsoft/vscode-ripgrep
- ripgrep README: https://github.com/BurntSushi/ripgrep
- JetBrains Find in Files: https://www.jetbrains.com/help/idea/finding-and-replacing-text-in-project.html
- JetBrains File-Based Indexes: https://plugins.jetbrains.com/docs/intellij/file-based-indexes.html
- Sublime Text Indexing: https://www.sublimetext.com/docs/indexing.html
- Sublime Text File Patterns: https://www.sublimetext.com/docs/file_patterns.html
- Zed Project Search: https://zed.dev/blog/nerd-sniped-project-search
- GitHub Code Search history: https://github.blog/engineering/a-brief-history-of-code-search-at-github/
- Sourcegraph Zoekt: https://github.com/sourcegraph/zoekt

## Open questions

- ignored / hidden files を UI でどう扱うか
- global result limit と per-file result limit をどう設けるか
- `Search` panel を `Explorer` / `Diff` とどう切り替えるか
