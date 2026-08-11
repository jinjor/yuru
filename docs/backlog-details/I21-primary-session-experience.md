# I21: primary session の体験を見直す

## 課題感

会社で yuru を使っていると、エージェントが自発的に「起動中のセッションと同じ worktree で新しい子セッションを複数起動する」ということをやり始めた。それが思ったよりも結構な高頻度で。（これは yuru skill の挙動ではないよね？）
それで何が起こったかというと、依頼元のセッションが見えなくなってカードが依頼先のセッションに置き換わった。
依頼元を開いているんだと思って「あれどうなった？」みたいに聞いたら依頼先のセッションだったりして、混乱する。
で、依頼先の作業が終わったようなのでセッションを Ctrl+C で終了。
すると、依頼元のセッション＋Detach Session（なぜか出るのが異様に遅い）が出たので detach 。
すると、何者かよくわからないセッションが１つ表示させれていて、これはクリックしても復元できない。
どうしようもないので、一度他のセッションを選択して戻ってくると、今度は依頼元セッションが表示された。
こ子で依頼元に戻る場合もあるが、２個目の依頼先が表示されることもある。その場合はまた同じことを繰り返す。

で、上記の挙動はバグっぽいんだが、そもそも構造が悪いんだと思うので、単なるバグ修正でなく Primary Session のあり方自体を見直す。
まずそもそも１つの worktree で複数のセッションが同時に走ることを yuru は想定していない。
だから primary を複数にするとか、ターミナルをタブみたいにするとか、カードにサブセッションを表示するとか、まあ色々やり方はあると思うが、最もシンプルな実装で最も優れた UX を提供したい。
あと今の UI の話をすると detach しないと他のセッションが見えないのも微妙で、セッションを閉じた時に全部並んでいて欲しい。
繰り返すけどこれは構造の問題なので UI だけ修正すればいいわけではなく、バックエンドや設定の持ち方まで含めて総合的に設計を考え直す必要がある。

---

# 設計メモ (2026-08-06)

## 調査で分かったこと

事案は個別バグの集まりではなく、モデルの不整合が根にある。

1. **primary の無条件上書き**
   - yuru skill の `session create --worktree <path>` は任意の既存 worktree を受け付け、
     同じ worktree を指定しても動く (エージェントが自分の worktree path をそのまま渡したのが今回の事案)。
     `--worktree` は必須で省略形はない。worktree の一致は path ベースで、branch 名は見ない。
     session create が worktree を作ることはない。
   - main は `attachPrimarySessionByPath` で既存 primary の有無を見ずに strong link を上書きする
     (`src/main/service.ts` の `createSessionForWorktree`)。
     依頼元の link が剥がれ、カードの表示が依頼先に差し替わったのはこれ。
2. **表示の単一化**
   - 右ペインは「表示中の terminal runtime」を 1 つだけ持つ (`SessionView` のローカル state)。
     worktree を選び直すと primary (= 依頼先) の runtime が初期表示されるので、
     依頼元を開いたつもりが依頼先だった、となる。
3. **復旧導線の脆さ**
   - session start surface は primary がある間は Resume / Detach しか出さず、
     suggested や新規の選択肢は detach 後にしか現れない (`TerminalSessionStart`)。
   - resume の失敗は renderer が黙って握りつぶす (`startTerminalRuntime` が `!result.ok` で return するだけ)。
     「クリックしても復元できない」はこの silent failure が絡んでいる可能性が高い。
   - primary 不在時に active runtime からカード用の primary item を合成する fallback
     (`src/main/repo-list.ts`) があり、「別セッションを選んで戻ると依頼元が復活した」のはこれ。

つまり「1 worktree = 1 session 前提のモデルと UI」に「エージェントが同じ worktree で
子セッションを並行起動する」という現実の使われ方が衝突している。

## 設計方針

**1 worktree に複数の primary session を認める。** エージェントの自発行動がすでにそちらを
向いており、1:1 強制 (委譲は必ず新 worktree) は流れに逆らう上に worktree 数の膨張と
ファイル非共有という歪みを生む。

参考にした既存ツール:

- cmux: 縦タブ = live surface、上の階層に workspace。agent の入力待ちをタブの通知リングで示す。
- herdr: Workspace → Tab → Pane (実 PTY) の 3 層。コンテナは live プロセスと結びつく。

どちらも「セッションを収めるコンテナは live プロセスと結びつき、その上に組織化の階層がある」
形で、空のコンテナを自由に作らせるモデルは取っていない。Yuru はこれに加えて
**provider session (永続・resume 可能)** と **terminal runtime (live PTY)** の 2 層を
すでに持っている。この 2 層構造に素直に沿う形として次を取る。

- **タブ = live terminal runtime の純粋な投影** (runtime と 1:1、密モデル)。
  runtime が生まれたらタブが増え、exit したらタブが消える。
  タブのための新しい永続 state は持たない。
- **ホームタブを常設**する。今の session start surface が発展したもので、
  その worktree の全 session (primary 群 + suggested + 新規作成) が常に並ぶ。
  セッションを閉じるとタブが消えてホームに戻り、全部並んで見える。
  「タブがある状態で新しいセッションを始める場所」問題はホームが常にあるので発生しない。
- **カードは代表セッションのみ**。一覧は出さない。見た目のごちゃつきを避ける。

疎モデル (空タブを自由に増やせる) は、タブとセッションの 2 つのライフサイクル同期コストに
見合う用途が観察された使い方にないため取らない。

## F51 との関係

I21 は F51 (SessionView keep-alive、`docs/backlog-details/F51-worktree-keep-alive.md`) の
上に乗る。ただし F51 の現行設計には 1 つ修正が必要な点が見つかっている (2026-08-06)。

(2026-08-09 追記: F51 は下記の shell 分離の修正を含めて main に完了済み。
以降の記述で「分離後の構造」とあるものは現行コードそのものを指す。)

- F51 は SessionView instance を keep-alive の単位にしており、描画集合が
  「session が active な worktree」に連動する。しかし Changes / Files / Search /
  preview の状態は本来 worktree に紐づく情報で、session の状態に依存しない。
  現行設計だと hidden 中に session が exit しただけで、これらの状態が instance ごと
  消える。F51 の設計メモが「session のない task worktree は選択解除で忘れる。
  線引きとして受け入れる」としていた箇所がこのカップリングであり、設計ミスと判断する。
  複数 session を認める I21 では「session の寿命 = view の寿命」という前提自体が
  さらに破綻する (session の 1 つが終わっただけでは何を消すか定義できない)。
- 修正の方向は I21 の分解と一致する。keep-alive の単位を分離する:
  - **worktree スコープの shell** (タブバー・ホーム・ExplorerPanel・preview)。
    session の有無に関わらず生きる。描画集合は「main ∪ 訪問済み ∪ 選択中」で、
    訪問済みは App が持つ worktreeId の小さな集合 state (外部保管庫ではない)。
    worktree の削除には repos からの導出で自動的に追従する。
  - **runtime スコープの terminal panel** (runtimeId で keyed な Activity の子)。
    runtime と一緒に生き、一緒に死ぬ。
- この分離は F51 側で先に直すことに決めた (2026-08-06)。
  修正設計は f51 worktree の
  `docs/backlog-details/F51-keep-alive-shell-separation.md` にある。
  I21 は分離後の構造を前提とする。

その上で、F51 の以下の判断には従う:

- 表示状態は component の local state に保持し、外部の保管庫もバックエンド保持も
  作らない (「状態を動かさない」)。I21 の現在タブ state は shell の local state に持つ。
  (初版メモでは main process の process memory に持つ案を書いていたが、
  F51 が却下した「バックエンドで持つ」と同じ構造なので撤回した)
- app 再起動をまたぐ永続化はスコープ外。

## モデル

- metadata の `taskWorktrees[].primarySession` (単数) を `primarySessions` (配列) に変える。
  要素の形 (`provider` / `providerSessionId` / `cwd`) は変えない。
  読み込み時に旧形式を単要素配列に migrate し、書き込みは新形式のみ。
- 「1 provider session は同時に複数 task worktree の primary にはならない」制約は維持する。
  attach / promote 時に他 worktree から同じ session を外す既存の挙動を配列版に拡張する。
- primary になる経路は 3 つ。いずれも上書きではなく追加。
  1. Yuru から新規 session を作成
  2. suggested session を resume (promote)
  3. yuru API の `session create`
- detach は「他の session を見るための関門」ではなくなり、
  「この worktree への strong link を外す」だけの操作に格下げされる。
  active な runtime を持つ session は従来通り detach できない。
- suggested session の扱い (provider store の path hint による weak candidate) は変更しない。

## UI

### タブ

タブ列は Terminal 領域のヘッダ行 (`.panel-header.terminal-bar`) そのものにする
(2026-08-09 決定。独立したタブバーを新設する案は却下)。
従来の `<h2>Terminal</h2>` 見出しは消し、その位置に `[ホーム] [runtime タブ...]`
のタブ列を置く。右側のブランチ名・PR バッジは従来通り残る。
Explorer パネルのヘッダ (`ExplorerPanel`) が中身 `.panel-tabs` だけの構成を
既に取っており、「ヘッダ行 = タブ列」はその先例に倣う形で、
左右のパネルヘッダの高さも揃う。
見た目は `docs/mockups/I21-session-tabs.html` を参照。モックは実アプリの
`style.css` とコンポーネントの DOM 構造をそのまま使っているので、
見えているものがそのまま実装の目標になる (新規 UI はタブ列のみ)。

- ホームタブは常に先頭にあり、閉じられない。ラベルはアイコンのみ。
- runtime タブのラベルは **session の preview の短縮** とする (2026-08-06 決定。
  provider 名 + 連番は却下)。
- タブが増えたときは横スクロールさせず、**タブ自体が縮む** (2026-08-09 決定)。
  タブ数 = その worktree の live runtime 数で、現実的には 2〜5 に収まる。
  全一覧はホームタブが常に持つので、「入り切らない分が見えない」コストは低い。
  それでも入り切らなくなるなら `overflow-x: auto` を足すのが逃げ道だが、
  必要になるまでは入れない。
- activity 状態 (working / waiting) はテキストバッジでは付けず、
  左ペインのカードと同じドット表現 (`SessionProviderDot` の点滅・点灯) を
  タブでもそのまま共有する (2026-08-06 決定)。裏で動いている子セッションに
  気づけるようにするための表現。
- 手動でタブを閉じる (x) と runtime を kill する。provider session 自体は残るので
  ホームから resume できる。破壊的ではないので確認ダイアログは出さない。
- main worktree の standalone terminal も runtime なので同じタブに乗る。
  将来の「worktree で素のターミナル」需要もこの部品で受けられる。

### 現在タブ (view state)

「その worktree で今どのタブを見ているか」は **worktree スコープの shell
(F51 との関係を参照) の local state** に持つ。外部の保管庫は作らない
(F51 の「状態を動かさない」にそのまま乗る)。
shell は session の有無に関わらず keep-alive されるので、worktree を行き来しても
保持され、これが「最後に選択されたタブを覚えておく」の担い手になる。

- 記憶の寿命 = shell の寿命 = その worktree を訪れてから app 終了 (または worktree
  削除) まで。runtime が全滅しても shell は生きるが、指していた runtime は
  死んでいるので、表示は下記の導出によりホームになる。
  app 再起動で忘れるのはタブ (= runtime の投影) が消えている以上、意味論的に正しい。
- 表示するタブは導出で決める: local state が生存中の runtime を指していればそれ、
  指していなければ (fresh mount・表示中 runtime の exit 直後) ホーム。
  runtime の単数 / 複数で分岐しない。
- タブの一覧と runtime の生存は local state やイベント購読ではなく
  worktree prop (repo list) から導出する。hidden 中は effect が止まり
  イベントを聞き逃すため (F51 の state 分類の規律に従う)。
  この導出に必要な active runtime 一覧は、F51 で worktree item の
  `activeTerminalRuntimeIds` として既に載っている (2026-08-09 確認)。

### ホーム

現行の session start surface を発展させ、primary の有無で出し分けをやめる。

- primary session 全件: preview、provider、active / inactive、activityState。
  active なものはクリックでそのタブを選択。inactive なものはクリックで resume。
  detach は各 item の副操作として残す。
- suggested session 全件: 現行通りクリックで promote + resume。
- 新規 session (Claude / Codex / Kimi): 現行通り。
- main worktree: Open Terminal。

### カード

- 表示は代表セッション 1 つだけ。代表のルールは **先頭の primary 固定** とする
  (2026-08-06 決定)。
  - カードの本質は worktree の識別アンカーで、子セッションの状態で表示が
    コロコロ変わると認知負荷が高い。注意喚起 (waiting / working) はタブバーの
    役割であり、カードの役割ではない (waiting 優先の導出案はこれで却下)。
  - 「先頭」は metadata の `primarySessions` 配列の先頭。attach は常に末尾追加、
    detach は除去なので、先頭を detach すれば次が繰り上がる (継承)。
    逐次利用でも自然に「今のメイン」が先頭に来る。新しい状態は不要で、
    metadata 由来なので再起動をまたいでも安定する。
    なお並びが変わるのは detach と re-promote の明示操作だけである。
    セッションの中断 (runtime の exit) や resume は配列に触らないので、
    親を一時中断してもカードの代表は親のまま (inactive 表示になるだけ) である。
- 「選択中のセッションをカードに出す」拡張は、P17 (getRepos の痩せ化とカード側の
  個別取得) の後に additive に足す。カードの表示データを frontend が組み立てる
  ようになれば、選択 state (shell local から App top に lift するが、
  frontend・非永続のまま) をそのまま使え、main に選択状態を持たせる IPC は
  要らない。P17 より前にやるとその IPC と main 側 view state が必要になるため
  I21 ではやらない。再起動時は先頭固定に戻る fallback でよい。
- 複数 session があることの件数表示は v1 では入れない (見た目のごちゃつきを避ける)。
  必要性が出たら別途検討する。

## 操作セマンティクス

- **Yuru から新規 session 作成 / suggested を resume / primary を resume**:
  runtime を起こし、タブを追加して選択する (現行と同じ体感)。
- **API の `session create`**: primary を追加するだけで、現在タブも選択中 worktree も変えない。
  新しい runtime はタブとして現れ、activityState で動いていることが分かる。
  provider session id が遅れて解決する provider は、解決後に primary へ追加する (上書きではない)。
- **session の exit**: タブが消える。表示中のタブが exit したらホームに戻る。
  表示していないタブが exit しても表示は変わらない。
- **active な primary をホームでクリック**: resume ではなくタブ選択。
- **worktree 削除**: 現行の session 停止・プロセス確認の flow は複数 session に拡張するだけ。

## 失敗時の挙動

- **resume の失敗を surface する**。現行は renderer が黙って握りつぶすが、
  画面右下に**トースト通知**を出す (2026-08-09 決定。ホームへの埋め込み案は却下)。
  数秒で自動的に消え、× でも閉じられる。
  埋め込み案は「いつ消すか」の寿命管理が要り、無関係なセッション操作で
  クリアされるのは違和感があるため却下した。トーストだと link 除去による
  行の消失の説明も一緒に消えるが、resume の失敗は稀なので許容する。
- provider store から消えている primary の resume は失敗させた上で link を外す
  (現行の「消えている primary は detach する」の配列版)。
  link を外すとホームの行は消える。左のカードは worktree 自体が残るので
  消えず、代表が先頭から繰り上がる (唯一の session なら session なしカードの
  見た目に戻る)。spawn 失敗などの一時的な失敗では link も行も残す。
- API `session create` の失敗は現行通りエラーを返す。既存 primary への副作用は
  モデル変更により構造的に消える (追加しかしないため)。
- worktree が削除された後に遅延解決した session id の attach は現行通りスキップする。

## CLI / skill

- `session create --worktree` を省略可能にし、省略時は Yuru がターミナルに注入している
  `YURU_WORKTREE_PATH` (= 呼び出し元の worktree) を使うことを検討する。
  1:1 モデル時代は「同じ worktree に子セッション」の事故を増やすだけだったが、
  複数 primary を認めるモデルでは副作用が「追加」しかないので足してよい。
  skill 側の記述も合わせて更新する。実装は小さく独立しているので別タスクに切ってもよい。
- `worktree create` のエラー (`Branch "..." already exists` / `Worktree "..." already exists`) は
  現状で十分分かりやすく、変更しない。

## スコープ外

- ペイン分割 (同時表示)。cmux / herdr は持つが、今回はタブ切替まで。
  依頼元 ⇄ 依頼先の往復はタブで十分高速になるはず。
- カードへの session 一覧・件数表示。
  ただし「pin したセッション」をカードに出すアイデアは将来の候補としてありうる
  (2026-08-06 の会話より。要件にはしない)。
- カード代表の「選択中セッションへの追従」(P17 後に additive に足す。カード節を参照)。
- suggested session の検出精度の改善。

---

# 実装設計とステップ分割 (2026-08-09)

実装者向けの節。対象コードは main HEAD (cdc9052 時点。F51 の shell 分離済み)。
設計の根拠・判断履歴は上の設計メモ側を参照。ここには「現状コードからの差分」と
「完了条件」だけを書く。行番号は 2026-08-09 時点のもので、ずれていたら関数名で探すこと。

## 共通ルール

- 各 Step は main からブランチを切り、前の Step が main に merge されてから次に着手する
  (Step 5 だけは独立していつでもよい)。
- 実装者はまずこの文書全体を読むこと。UI の見た目の目標は
  `docs/mockups/I21-session-tabs.html` (実アプリの style.css と DOM 構造をコピーした
  モック) が正とする。
- 完了条件は各 Step の e2e 追加 + 既存テスト全通過 + `npm run build` が通ること。

## 現状コードの前提知識 (調査済み)

- metadata: `TaskWorktreeMetadata.primarySession` は単数 optional
  (`src/shared/metadata.ts`)。永続化は `src/main/metadata.ts` で、
  **migration 機構はなく parse 時の後方互換で対処する方式**。
- 上書きが物理的に起きるのは `attachPrimarySessionByPath`
  (`src/main/metadata.ts`) の代入 1 箇所のみ。同関数内に「同一 provider session は
  全 worktree で高々 1 つの primary」制約の強制 (他 worktree から剥がす) がある。
- attach の呼び出しは 3 経路のみ: 新規作成 (`createSessionForWorktree`)、
  lazy id 解決 (`resolveLazySessionId`)、suggested の promote
  (`promotePrimarySession`)。いずれも `src/main/service.ts`。
- detach は `detachPrimarySession` (service.ts、active runtime ガード付き) と
  `detachPrimarySessionByPath` (metadata.ts)。provider store から消えた primary の
  detach は resume 時のみ (`activateWorktreeSession` の `detachMissingPrimary`)。
- repo list: `toWorktreeListItem` (`src/main/repo-list.ts`) がカード用の単数
  `primarySession` を組み立てる。primary 不在で provider 付き runtime が生きている時に
  1 件合成する fallback があり、合成品は `providerSessionKey: null` が目印。
  suggested は primary と同 key を除外している。
  **`WorktreeListItem.activeTerminalRuntimeIds: string[]` は F51 で既に存在する**。
- renderer: keep-alive は React `Activity` (App.tsx)。SessionView は
  `selectedTerminalRuntimeId` (local state) と `primarySession?.activeTerminalRuntimeId`
  から `displayedTerminalRuntimeId` を導出し、`TerminalPanel` を
  `key={displayedTerminalRuntimeId}` で remount する (xterm は作り直し)。
  `session:changed` push の repo list への反映は `applySessionUpdate`
  (`src/renderer/utils/repoList.ts`)。
- トースト相当の UI は現存しない。error center (main 起点) はあり、
  resume 系の失敗は `failAndReport` 経由で既に記録される。
- IPC: session 系は `src/preload/index.ts` の `createSessionForWorktree` /
  `resumePrimarySession` / `resumeSuggestedSession` / `detachPrimarySession` /
  `openWorktreeTerminal`。**runtime を kill する IPC は現存しない**
  (worktree 削除時の runtime 停止処理は service 内にある)。
- e2e の足場: `test/e2e/helpers.ts` の `writeMetadata` (metadata 直書き seed)、
  `app.evaluate` による `session:changed` 注入、yuru CLI からの `session create`。
  fake provider はない。hidden SessionView の DOM が残るので右ペイン操作は
  `visibleSessionView` で scope する。

## Step 1: metadata の複数 primary 化 (main + shared)（完了）

UI は変えない (renderer は先頭要素だけ見る暫定対応)。後方互換で単独 merge 可能。

- `TaskWorktreeMetadata.primarySession` → `primarySessions: PrimarySessionMetadata[]`
  (要素の形は不変)。`parseTaskWorktree` で旧単数形を単要素配列に migrate し、
  書き込みは新形式のみ。
- `attachPrimarySessionByPath`: 上書きをやめ**末尾追加**。同一 key が同 worktree に
  既にある場合は追加しない (冪等)。全 worktree 通じた一意制約は維持する
  (他 worktree の配列から除去してから追加)。
- `detachPrimarySessionByPath` / `detachPrimarySession` /
  `findPrimarySessionResumeTarget`: 配列走査に変える。UI 契約
  (worktreeId + providerSessionKey) と active runtime ガードは不変。
- `activateWorktreeSession` の `detachMissingPrimary`: 該当要素だけを外す。
- `toWorktreeListItem`: `WorktreeListItem.primarySessions: PrimarySessionListItem[]`
  を組み立てる (各要素の preview / state / activityState / activeTerminalRuntimeId は
  現行の単数ロジックを要素ごとに適用)。suggested の除外は全 primary key で。
  fallback 合成は `primarySessions` が空の時だけ発動させる。
- renderer は型追従のみ: カード (`RepoList.tsx`) と SessionView の
  `primaryTerminalRuntimeId` 導出、`applySessionUpdate` は「先頭要素」を見る形にして
  現行表示を維持する。`test/e2e/helpers.ts` の `writeMetadata` も新形式に。
- 完了条件: 既存 e2e 全通過 (挙動不変)。attach が上書きでなく追加になること、
  一意制約、migrate をカバーする `test/main/` の単体テスト追加。

## Step 2: タブ列 (renderer 主体 + kill IPC)（完了）

- `SessionTabs` コンポーネントを新設し、`TerminalBar` の `<h2>Terminal</h2>` を
  タブ列に置き換える (ブランチ名・PR バッジは右に残す)。見た目はモック通り:
  `.panel-tab` 系の値に倣い、タブは `max-width` + `min-width: 0` で縮み、
  横スクロールは付けない。
- タブの並びは `[ホーム][runtime タブ...]`。runtime タブは
  `activeTerminalRuntimeIds` の順。ラベルは `primarySessions` の
  `activeTerminalRuntimeId` から対応 session の preview 短縮。
  対応 session がない runtime (id 未解決の lazy provider、standalone terminal) は
  固定ラベル ("Terminal" など) でよい。activity は `SessionProviderDot` と同じ
  ドット表現。
- 現在タブ state: `selectedTerminalRuntimeId` を流用し、導出を
  「明示選択が `activeTerminalRuntimeIds` に生きていればそれ、なければホーム」に変える
  (active primary への fallback は廃止。fresh mount はホーム)。
  main worktree の自動 `openWorktreeTerminal` は維持 (開いた runtime が選択される)。
- ホームタブの中身はこの Step では現行 `TerminalSessionStart` のまま。
- × ボタン用に **runtime を kill する IPC を新設**する
  (worktree 削除時の runtime 停止処理を再利用。provider session は残るので
  ホームから resume 可能)。確認ダイアログは出さない。
- タブ切替の TerminalPanel は現行通り key remount。runtime 単位の xterm
  keep-alive は入れない (切替コストは現行と同じで悪化しない)。
- 完了条件: タブの表示・切替・× で kill・runtime exit でホームに戻ることの e2e
  (helpers.ts の metadata seed / push 注入 / CLI からの session create を組み合わせる)。

## Step 3: ホーム発展 (renderer)（完了）

- `TerminalSessionStart` をホームに発展させ、primary の有無による分岐を廃止:
  Sessions (全 primary) / Suggested / New session を常時表示する
  (main worktree は従来通り Open Terminal のみ)。
- active な primary 行: クリックでタブ選択 (`selectedTerminalRuntimeId` をセット)。
  inactive 行: クリックで resume。detach は inactive 行の副操作として残す。
- suggested は現行通り promote + resume (成功するとタブが増えて選択される)。
- 完了条件: 複数 primary の一覧表示・active 行のタブ選択・inactive 行の resume・
  detach・suggested の promote の e2e。

## Step 4: 失敗時の挙動 (renderer)（完了）

- トーストコンポーネントを新設 (App レベル、画面右下、数秒で自動 dismiss + × で
  手動 dismiss)。`startTerminalRuntime` が `!result.ok` を握りつぶしている現行をやめ、
  `AppError` の message / detail をトーストに出す。
- store から消えた session の resume 失敗では main が link を外す (Step 1 で配列対応済み)
  ので、ホームの行が消えることと整合する文面にする。
- resume 失敗が error center にも記録される既存挙動はそのまま残す
  (トーストはその場の見え方として追加するもので、置き換えではない)。
- 完了条件: 存在しない session id の resume でトーストが出て行が消える e2e
  (metadata 直書き seed で再現できる)。

## Step 5: CLI / skill (独立・任意)

- `session create --worktree` を省略可能にする。解決順は
  `YURU_WORKTREE_PATH` → `process.cwd()` (primary worktree のターミナルには
  `YURU_WORKTREE_PATH` が注入されないため。cd 後に狂う caveat は許容し、
  パス検証は現行通り main 側に任せる)。**main 側の変更は不要**。
- `scripts/yuru-cli` の help テキストと `skills/yuru/SKILL.md` の記述を更新する。
- 完了条件: 省略形で session が作られることの手動確認。
