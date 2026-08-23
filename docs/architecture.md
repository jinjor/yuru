# Architecture Notes

Last updated: 2026-08-16

この文書は現在の Yuru のアーキテクチャをまとめる。
実装の細部、型定義、処理手順の正確な姿はコードを正とする。

## Core entities

Yuru の中では、Claude Code / Codex CLI / Kimi CLI そのものを `agent` と呼ぶ。
`provider` は agent の提供元を指し、session store の形式や resume command のように
提供元ごとに処理が分岐する所にだけ現れる。分岐を隠した抽象の側は agent と呼ぶ。

- `repo`
  - Yuru が左ペインの主導線に表示する単位
  - task worktree 群の親になる
- `task worktree`
  - `repo` の main worktree を除いた Git worktree
  - Yuru の中心的な作業単位
  - `Files`, `Changes`, diff, preview の基準になる
  - 現在位置は `worktreePath` で表す
- `primary session`
  - task worktree に attach された session
  - 1 task worktree に複数存在でき、ユーザーが並び替えた順を保持する (新しい session は末尾)
  - 1 agent session は同時に複数 task worktree の primary にはならない
- `suggested session`
  - Yuru 外で作られ、task worktree に紐づいていると推測される session
  - agent store から推測した weak candidate
  - 明示的な昇格操作までは primary として扱わない
- `terminal runtime`
  - Yuru が現在起動している PTY process
  - active / inactive 表示は terminal runtime の有無から導出する
  - provider session ID が判明した runtime は、その session の primary worktree に結びつく
  - provider session ID が未確定の runtime と standalone terminal は、起動対象 worktree に結びつく
  - terminal runtime 自体は永続化しない

## Source of truth

- Git
  - repo が実在する Git repository かどうか
  - worktree path
  - current branch / detached HEAD
  - status, diff, file content
- agent store
  - Claude / Codex の保存済み session
  - agent session id
  - last message や timestamp
  - worktree session detection 用の path hint
- Yuru metadata
  - どの repo を主導線に表示するか
  - repo と task worktree の path link
  - task worktree と primary session の strong link
  - 一覧の表示順 (repo / task worktree / primary session をユーザーが並び替えた順)
- file review store
  - worktree ごとの、ファイル内容に対するレビュー済み宣言
  - 表示中の checked 状態そのものではなく、fork 元と承認済み内容の blob OID を保存する
- recent file store
  - repo ごとの、プレビューで開いたファイルの新しい順の並び
  - ファイル検索パレット (Cmd+P) の、入力前の候補になる
- process memory
  - active terminal runtime
  - PTY process と scrollback
  - file watcher の購読状態

Yuru metadata は source of truth の複製ではない。
Git や agent store が持っている状態を丸ごとコピーせず、Yuru 自身が主導線を組み立てるために必要な最小限の情報だけを持つ。
branch、diff、agent session の本文、terminal runtime は metadata に保存しない。

Claude / Codex の会話ログは provider adapter が物理ファイルごとに 1 つの
`IncrementalJsonlReader` で増分読み取りする。adapter は provider 固有の record を一度だけ
user / assistant の会話へ変換し、その結果で preview を更新すると同時に bookmark 取得側へ通知する。
Kimi の preview は従来どおり `state.json` の `lastPrompt` / `title` から読み、bookmark 用の会話だけを
`wire.jsonl` の `IncrementalJsonlReader` で増分読み取りする。どちらも既存の session monitor の
同じ tick で確認し、bookmark 専用の polling は持たない。

metadata は通常 `~/.yuru/metadata.json` に置く。
テストや開発用に `YURU_METADATA_PATH` で保存先を差し替えられる。

最小 schema は次の形である。

```json
{
  "repos": [
    {
      "id": "uuid",
      "repoPath": "/path/to/repo"
    }
  ],
  "taskWorktrees": [
    {
      "repoId": "uuid",
      "worktreePath": "/path/to/worktree",
      "primarySessions": [
        {
          "provider": "codex",
          "agentSessionId": "..."
        }
      ]
    }
  ]
}
```

`primarySessions` は strong link がなければ空配列になる。
旧 schema の `primarySession` は読み込み時に単要素配列へ変換し、以後の書き込みは
`primarySessions` だけを使う。
旧 schema の `providerSessionId` も同じく読み込み時に `agentSessionId` として扱う。
Git 上には存在するが、まだ Yuru metadata に strong link を持たない worktree もありうる。

ファイルのレビュー記録は metadata とライフサイクル・書き込み頻度が異なるため、
`~/.yuru/file-reviews.json` に分けて保存する。worktree の絶対 path とファイルの相対 path を key にし、
値は「fork 元の blob OID : 承認した内容の blob OID」である。現在の表示がレビュー済みかどうかは、
この記録と Git の各層にある実際の blob OID を比較して毎回導出する。

ブックマークも同じ理由で `~/.yuru/bookmarks.json` に分け、worktree の絶対 path ごとに
URL と title の配列を追加順で保存する。

最近開いたファイルの履歴も同じ理由で `~/.yuru/recent-files.json` に分ける。
こちらは worktree ではなく repo の絶対 path を key にし、値は開いたファイルの相対 path を
新しい順に並べた配列である。同じ repo の worktree は履歴を共有し、候補は選択中 worktree の
ファイルを指す。よく使うファイルは worktree をまたいで必要になるためである。
開いた経路 (ファイルツリー、Changes、ターミナルのリンク、パレット) は区別せず、
プレビューに出たファイルをそのまま記録する。worktree の外を指す絶対 path は、
他の worktree で開き直せないので記録しない。表示時は選択中 worktree のファイル一覧と
突き合わせ、そこに無いファイルは候補から落とす。

## Repo assembly

左ペインの repo 一覧は、まず Yuru metadata の `repos` から組み立てる。
これにより、worktree が 0 件の repo でも Yuru 上で作業開始の起点にできる。

各 repo の task worktree 一覧は、その repo に対して Git から worktree 群を読んで組み立てる。
main worktree は task worktree として表示しない。
task worktree は、ユーザーが並び替えた順に表示する。並びが保存されていない worktree
(新しく作ったものや Git で直接作ったもの) は、その後ろに Git の管理ディレクトリの
作成日時が古い順で並ぶ。
その上に Yuru metadata、agent store、active terminal runtime を重ねる。

- metadata の `primarySessions` が有効なら、それらを task worktree の primary として扱う
- agent store の hint から worktree 配下の session を推測できる場合は suggested session として表示する
- primary / suggested session に対応する terminal runtime があれば active として表示する
- metadata にない Git worktree も、primary なしの task worktree として表示する

provider の path hint は candidate 推測にだけ使う。
task worktree と primary session の strong link は、作成・昇格・解除 (detach) の明示操作でだけ変わる。
provider runtime のタブ表示先はこの strong link から導出する。session ID がまだ分からない期間は
runtime の起動対象 worktree に暫定表示し、ID 解決と primary attach 後に strong link へ切り替える。
standalone terminal は session を持たないため、起動対象 worktree に表示する。

worktree の外部 rename は自動追跡しない。
古い path の strong link は起動時 maintenance で削除され、新しい path は primary なしの Git worktree として再発見される。

## Agent sessions

対応 provider は Claude と Codex である。
provider ごとの session store や resume command の違いは agent の実装 (`src/main/agents/`) に閉じ込める。

Claude / Codex の session preview は、初回に JSONL の末尾から最新の assistant message までを
読み、以後はその位置から追記された record だけを読む。preview に不要な過去の tool result などを
走査しないため、ログ全体のサイズは初回表示の読み取り量に影響しない。Kimi の preview は
`state.json` の `lastPrompt` / `title` から読む。

worktree session の create / resume は、Claude / Codex とも cwd = repo root で起動する。
PTY 内で `cd` しても、`Files`, `Changes`, diff の作業ルートは runtime cwd ではなく選択中 task worktree の `worktreePath` で決まる。

worktree の作成と agent session の開始は別の操作である (F43)。
task worktree に対して新規 session を開始すると、agent session id が起動時に取れる場合は
その場で primary の末尾に attach し、遅れて分かる provider は session id 解決後に attach する。
初回起動時だけ worktree context を hidden prompt として注入する。
この prompt は「agent session は repo root で起動しているが、実際の作業場所は task worktree である」ことを明示し、ファイル操作・コマンド実行・build/test は `worktreePath` で行い、回答中のファイルパスは `worktreePath` 基準の相対パスまたは絶対パスで記述するよう指示する。
あわせて、このメッセージは Yuru が注入した環境コンテキストでありユーザーからのタスク指示ではないこと、ユーザーが明示するまで作業を開始しないことも指示する。

- Claude: `--append-system-prompt`
- Codex: `-c developer_instructions=...`

resume 時には worktree context を再注入しない。
Codex は repo root から保存済み session を再開するため、resume command に `--all` を付ける。

worktree context prompt は `~/.yuru/worktree-context-prompt.txt` で差し替えられる。
ファイルがない場合は Yuru 組み込みの default template を使う。

## Operations

- install
  - launcher は `~/.yuru/bin/yuru` に固定し、managed checkout は `~/.yuru/repo` に置く
  - launcher の絶対パスで `yuru latest` を実行して初回の `Yuru.app` を生成した後、shell の設定手順を表示する
  - `~/.yuru/bin` が現在の `PATH` に無い場合は、`$SHELL` に応じた設定手順を表示する。現在は zsh だけに対応し、`.zshrc` を installer 自身では変更しない
- `yuru latest`
  - managed checkout の `main` を fast-forward した直後に `~/.yuru/bin/yuru` を更新する
  - その後、lockfile audit、`npm ci`、build、local packaging の順に実行し、`~/Applications/Yuru.app` を置き換える
- `yuru add <directory>`
  - 指定した directory から Git repo root を解決し、Yuru metadata に repo を登録する
  - すでに登録済みなら重複登録しない
- create task worktree
  - repo row の `+` から branch name だけを入力する。provider は選ばない
  - 作成方法は 2 つあり、モーダルのタブで選ぶ (F42)
    - New branch: HEAD から新しい branch を切る
    - From origin: origin の branch を fetch して同名の local branch で取り込み、
      upstream を `origin/<branch>` にする。PR の head branch 名を貼り付けて、
      その PR を task worktree として開く用途
  - branch name の `/` は worktree name では `-` に置き換える
  - worktree path は provider によらず `<repo>/.yuru/worktrees/<worktreeName>` (Yuru が決める)
  - 既存 directory や既存 branch がある場合は作成しない
  - session は開始せず、作成した worktree を選択した状態にする
  - 過去に provider 別の配置 (`.claude/worktrees` / `.yuru/worktrees`) で作られた worktree は
    移行せず、そのまま Git worktree として扱う
- start session for worktree
  - task worktree の Terminal ホームには、primary session 全件、既存 session (suggested)、
    新規 session (Claude / Codex) の選択肢が常に出る
  - 新規作成した worktree も既存の Git worktree も、この同じ flow で session を開始する
  - session の起動に失敗しても worktree は削除しない
- resume primary session
  - primary session がすでに active terminal runtime を持つ場合は、その terminal runtime を選択する
  - inactive の場合は agent store の session を確認してから resume する
  - 同じ agent session の resume / promote が並行した場合は 1 件の起動処理を共有し、live runtime を 1 件だけ作る
  - agent store から消えている primary は detach する
- promote suggested session
  - suggested session を primary に昇格し、resume / select する
  - 同じ agent session が別 task worktree の primary だった場合は、元の strong link を外す
- detach primary session
  - inactive な primary session の strong link だけを外す。worktree・Git の変更・agent store の session 履歴は消さない
  - active な terminal runtime を持つ間は detach できない。先に terminal 内でセッションを終了する
  - 外した session は agent store の path hint があれば suggested として再発見される
- remove worktree
  - 確認ダイアログ内の準備と、その後のバックグラウンド削除を分ける
  - 準備の最初に dirty を確認し、dirty ならセッションを止める前に force remove の明示確認へ切り替える
  - 削除が承認されたら、その worktree の primary session に対応する provider runtime、
    ID 未確定中にその worktree 向けに起動した provider runtime、standalone terminal を停止する。
    primary session に対応する provider runtime は、その PTY の実際の cwd にかかわらず停止対象になる
  - その後も worktree を cwd にした生きたプロセスがないか OS に問い合わせる (lsof)。残っていれば command と PID を一覧表示する
  - 別 worktree の primary session に対応する runtime でも、削除対象 worktree を実際の cwd として
    使用中なら lsof の一覧に含め、停止の明示確認なしには worktree を削除しない
  - プロセス停止の明示確認後は、表示時になかったプロセスを止めないよう再照合して全件へ SIGTERM を送り、終了を確認する。終了していなければ最新の一覧を同じダイアログに表示し、削除へ進まない
  - 追加確認が不要になった時点でダイアログを閉じ、カードを操作不能な `Removing…` 表示にして `git worktree remove` (`force` 承認済みなら `--force`) を実行する
  - 実削除の直前にも新しい session / process がないか再確認する
  - 削除が成功したら metadata の task worktree record と file review record も削除する。branch と agent session 履歴は残す
  - 実削除に失敗したら一覧を再取得してカードを実態に合わせ、モーダルは開かない。準備後に dirty / process が発生した場合は warning、その他の失敗は error として Error ログに記録する
- startup maintenance
  - app 起動時に registered repo が Git repository のままかを確認し、そうでない repo record は
    その repo の task worktree record ごと削除する。削除したことは warning として Error ログに残す
  - 残った repo ごとに `git worktree list` を実行する
  - list に成功した repo だけ、metadata に残った stale task worktree record を削除する

## UI structure

左カラムは `repo > task worktree` を基本構造にする。
repo row は task worktree が 0 件でも表示し、新規 worktree session の起点になる。

task worktree row は branch、先頭の primary session の状態、provider、preview、suggested session の存在を表示する。
row のクリックは常に worktree の選択で、session やプロセスの起動は行わない (F43)。
row に残る操作は選択と `︙ → Remove worktree` (worktree lifecycle) だけである。

repo 行と task worktree カードは drag & drop で並び替えられる。並び替えは 1 つの入れ物の
中に閉じ (repo をまたいで worktree を動かすことはしない)、選択は変えない。決めた並びは
Yuru metadata に保存する。main worktree は常に先頭で、掴めず落とす先にもならない。

session lifecycle の操作は選択中 worktree の Terminal が担う。Terminal のヘッダは
`[ホーム] [live terminal runtime...]` のタブ列で、runtime の生成・終了から一覧を導出する。
ホームは常設で、session の一覧と開始操作を表示する。

- task worktree: primary session 全件、suggested session 全件、新規 session (Claude / Codex)
  を primary の有無に関わらず表示する
- active な primary 行: 対応する runtime タブを選択する
- inactive な primary 行: agent session を resume する。detach は行の副操作として表示し、
  strong link だけを外す
- suggested session 行: primary へ昇格して resume する
- main worktree: standalone terminal を開く操作

runtime タブは保存された primary session の順 (= ユーザーが並び替えた順) に active なものを
並べ、session id がまだ解決していない runtime と standalone terminal はその後ろに runtime の
起動順で並べる。
対応する primary session があれば preview と provider/activity のドットを表示し、対応が
なければ `Terminal` と表示する。× は terminal runtime だけを kill し、provider session の
履歴と primary link は残す。
active な suggested session を primary に昇格すると、既存 runtime のタブは同じ PTY と
scrollback を保ったまま新しい primary worktree へ移る。

ホームの primary session 行とタブは drag & drop で並び替えられ、metadata の primary session の
並びを書き替える。タブに出るのは runtime を持つ session だけなので、タブでのドラッグは
「落とした場所の左隣のタブの直後へ移す」(左端に落としたら全体の先頭へ) という規則で、
タブに出ていない session も含む全体の並びへ翻訳する。並び替えても表示中のタブは変わらない。

右側の `Terminal`, `Files`, `Changes`, preview は選択中の worktree に連動する。
App が持つ選択状態は `worktreeId` だけである (P20)。右ペイン (WorktreeView) は選択が
変わっても作り直さない。keep-alive の対象は「各 repo の main worktree (常時) ∪
一度でも選択した worktree ∪ 選択中」で、対象外の instance だけが React `<Activity>`
の hidden から実際に破棄される (worktree が repos 一覧から消えた時など)。表示状態は
各コンポーネントの local state が持ち主のまま動かない。ExplorerPanel の `Files` /
`Changes` / `Search` / `Bookmarks` タブも同じ理由で 4 つとも keep-alive し、タブを離れても展開・
検索語は残る。session の開始などの非同期操作が worktree を切り替えた後に完了しても、
結果は操作元の (hidden な) instance にしか反映されず、表示中の worktree を引き戻す
ことはない。

hidden な instance は effect が止まる (polling・watcher・イベント購読が止まる)。
visible に戻ると effect は再実行され、大半の state (git status、diff、Files の
ディレクトリ一覧など) はこれで最新化される。新しい state を足す時はこの前提を踏まえる:

- イベント購読でしか同期しない state は、hidden 中の聞き逃しに個別の対応が要る。
  「その worktree でいま選んでいる terminal runtime」は WorktreeView の local state で
  保持するが、exit イベントを hidden 中に聞き逃し得るため、表示直前に props
  (`activeTerminalRuntimeIds`、その worktree で今生きている runtime の一覧) と突き合わせる。
  選択先が死んでいればホームを表示する
- code search の結果は「復帰時の再実行で最新化する」の対象に**しない**。取得した
  時点のスナップショットとして扱い、query 文字列が変わらない限り再取得しない
  (一般的なエディタの検索結果と同じ挙動に合わせた設計判断)。query 自体はユーザー
  操作でしか変わらない state として保持する

ホームは複数 primary をすべて表示し、active 行は既存 runtime タブの選択、inactive 行は
resume を行う。fresh mount はホームを表示し、session 操作 (resume / promote / 新規 session /
standalone terminal 開始) が成功した時だけ、その runtime タブを選択する。API など外部から
生まれた runtime はタブだけを増やし、現在タブを変えない。main worktree は初回選択時に standalone terminal を自動で開く
(生きている runtime は IPC 側が再利用する)。session がなくても `Files`, `Changes`, preview
は worktree に対して使える。terminal runtime の exit では worktree の選択を保ち、表示中
runtime が終わった時だけホームへ戻る。main worktree でも自動では開き直さない。

`Files` と `Changes` のファイル行は、表示中の live `Terminal` へ drag & drop できる。
渡す文字列は選択中 worktree を基準にした相対 path で、Terminal の現在の入力位置へ paste する。
directory 行と、live runtime が選択されていない Terminal ホームは drop の対象にしない。

`Changes` は Git の層を `merge-base → HEAD → index → worktree` の重複しない区間に分け、
`Committed → Staged → Unstaged` の順で表示する。merge conflict は例外として `Conflicted` を先頭に置く。
`Committed` の基準は local default branch と HEAD の merge-base に固定し、ヘッダには実際の
branch 名を表示する。default branch は local の `main`、次に `master` を探して最初に見つかった
ものを使う。remote-tracking ref は一切見ないので、clone の仕方や fetch の状況に左右されない。
stacked branch の parent は推測せず、常に default branch からの全差分として見せる。
どちらの branch も無い、または HEAD と履歴が繋がっていない場合は推測不能であることを画面に出す。
PR の base へ暗黙に切り替えることもしない。PR のレビューに使う場合は、利用者が local default
branch を最新にしておく。
レビュー操作は diff ヘッダの `Reviewed` で行い、承認した内容が stage や commit で層を移動しても、
blob OID が同じならレビュー済み表示もその内容について移動する。
`Changes` の各 scope だけでなく、`Files` / `Search` から開く scope なしの
`HEAD ↔ worktree` 合算 diff でも、変更があれば worktree 内容をレビューできる。
`Reviewed` を押すと、押した時点でその層にある内容の blob OID を記録する。表示していた内容とは
照合しない。diff の polling 間隔 (3 秒) の内に agent が書き換えていた場合は、画面に出ていた内容
ではなく最新の内容が記録される。この窓を狭めるより、押した操作が必ず結果に反映されることを取る。

diff パネルは Markdown / HTML / 画像をプレビューとして描画でき、それ以外は差分テキストとして見せる。
画像だけはバイト列なので、テキストの diff document (path と両側の文字列) には載せず、別の IPC で
両側を data URL として取得する。取得の契機は差分テキストと同じで、変更ありのファイルと worktree 外の
ファイルは同じ間隔で取り直す。`Reviewed` は押した時点の内容を記録するので、画面が古いまま取り残されると
見ていない内容を承認できてしまうためである。同じ理由で、ファイルや scope を切り替えた時は前の画像を
残さない。scope の解釈はテキストと同じ差分ローダを使うので、
`Committed / Staged / Unstaged` と合算 diff のどれでも同じように前後を出せる。
両側がある場合は前後を並置する。2 枚は両側の最大寸法を共通の座標系として同じ倍率で置くので、
寸法が変わったことも見た目の差と一緒に分かる。重ね合わせや画素差の表示は、フロントエンドの
見た目を詰める場面以外では必要にならないため作っていない。
SVG は画像として描画できるテキストなので、プレビューでは描画、閲覧では差分テキストになる。

Terminal の描画には xterm.js を使う。
stable 6.0.0 には IME の変換位置がずれて過去に入力したテキストの断片が再送されるバグがあるため、修正済みの 6.1.0-beta 系(VS Code が本番で使っているのと同じ系列)を使っている。stable 6.0.0 系に戻すと再発する。6.1.0 stable が出たらそちらに移行する。

PTY の出力は main process 側でも headless の xterm.js (`TerminalScreen`) に通し、画面とスクロールバックの状態として保持する。
セッションを切り替えて戻ってきた時は、この状態を serialize addon で復元用シーケンスに変換して renderer の端末に書き込む (VS Code のターミナル復元と同じ方式)。
生の出力ストリームを溜めて再生する方式は、容量制限で先頭を切り落とした時にエスケープシーケンスや TUI の再描画フレームの途中から再生されて表示が壊れるため使わない。

## Appendix

2026-05-16 までアーキテクチャ刷新を行なっていたため、このドキュメントに沿わない古い実装が残っている可能性がある。
移行時の判断と checklist は [task-worktree-first ADR](adr/20260516-task-worktree-first-model.md) に残す。
