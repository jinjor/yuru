# F52 Kimi を session provider として追加する

Last updated: 2026-07-20

## Goal

Claude / Codex に加えて、Kimi Code CLI (`kimi`) を Yuru の session provider として使えるようにする。
worktree への紐付け、session の開始・resume、suggested session の検出まで、既存 2 provider と同じ体験にする。

## Why

普段使いのエージェントを Kimi (K3) に移した。Yuru の作業単位 (task worktree + primary session) として
Kimi を開けないと、Yuru ごと使われなくなる。

## 前提調査: kimi CLI の事実

実機 (kimi 0.26.0) と公式ドキュメントで確認済み:

- セッション保存先は `~/.kimi-code/sessions/<workDirKey>/<sessionId>/`
  (`workDirKey` = `wd_<slug>_<sha256 先頭12桁>`)。データルートは `KIMI_CODE_HOME` で移動できる
- `~/.kimi-code/session_index.jsonl` が全セッションの索引。
  1 行ごとに `{sessionId, sessionDir, workDir}`。**workDir が直接書かれている**。
  worktree を cwd にして起動されたセッションはこれだけで worktree と対応付けられる
  (root 起動セッションの worktree 対応付けには wire.jsonl の evidence を使う。adapter の節を参照)
- セッションディレクトリ内の `state.json` に `title` (初回プロンプト) / `lastPrompt` / `createdAt` /
  `updatedAt` / `workDir` がある。プレビューは wire.jsonl をパースせずここから取れる
- 会話ログ本体は `agents/main/wire.jsonl`
- resume は `kimi --session <id>` (エイリアス `-S` / `-r`)。`kimi -c` は cwd の最新セッションを継続
- 新規セッション開始時、`session_index.jsonl` への追記は起動直後に行われる (spike で検証済み、後述)
- **workDir は realpath 済みで記録される** (macOS で `/tmp` → `/private/tmp` になった)。
  worktree パスとの比較は realpath 正規化が必要
- ディレクトリごとの trust 確認は**ない** (Claude の B10 相当の問題は起きない)
- `--append-system-prompt` 相当のフラグは**ない** (後述の起動設計に影響。
  公式リファレンスと 0.26.0 バンドル内の全フラグ文字列の両方で確認)
- hooks はあるが、設定場所は `~/.kimi-code/config.toml` (ユーザー級) のみでプロジェクト級はない。
  `UserPromptSubmit` hook は stdout をコンテキストに追記できる (ユーザーの発言ごと)。
  `SessionStart` は observation-only で返り値は main flow に影響しない
- kimi は子プロセスにネスト検知用の env (`CLAUDECODE` 相当) を**設定しない** (spike で検証済み)

参照: [Data locations](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/data-locations.html),
[kimi command](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html),
[Configuration files](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/config-files.html),
[Hooks](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html)

## Spike 結果 (2026-07-19, kimi 0.26.0)

マージ安全のゲートとして実施。全項目クリア。

- **TUI の index 追記タイミング**: PTY (`script`) で interactive TUI を起動し、
  プロンプト未入力の状態で約 1.6 秒後に `session_index.jsonl` へ追記された。
  `waitForSessionId` は index の poll で確実に実現できる (数百 ms 間隔・timeout 15 秒程度で十分)
- **worktree 起動時の workDir**: `git worktree` 内で起動すると、
  workDir に realpath 済みの worktree パスが記録された
- **resume の cwd 制約**: `kimi --session <id>` は **cwd がセッションの workDir と一致しないと
  エラーで拒否する** (`Session ... was created under a different directory. cd <dir> && kimi -r <id>`、
  exit 1)。Codex のような確認プロンプトではなく、案内付きの即時エラー。
  この制約は resume 時のプロセス起動ディレクトリの話であり、
  **セッション中にアクセスできるファイルを制限するものではない** (worktree 跨ぎは次項のとおり可能)。
  Yuru は resume を常に記録済みの `session.cwd` で起動し、
  採用設計 (root 起動) では session.cwd = workDir = repo root が常に成り立つため、
  この制約には自然に適合する
- **workspace 外アクセス**: worktree 内の session から、main checkout と sibling worktree の
  ファイルの read / write がどちらも成功した (hard block ではない)。
  `-p` (auto permission) での確認のため、TUI manual mode では通常の承認フローに乗ると想定されるが、
  その程度の摩擦は設計上許容済み
- **env マーカー**: kimi は子プロセスにネスト検知用の env を設定しない
  (バンドル内の env 変数はすべてユーザー設定入力。kimi セッションの子 shell の env にも
  kimi 由来の変数はなかった)。`terminal-env.ts` の変更不要。
  なお既存の CLAUDE 系マーカー無条件削除は、claude セッション内から起動された kimi を
  保護する方向にも効いている
- **workDir 削除後の挙動**: workDir を消すと resume は拒否されるが、
  `kimi export <id>` は成功し全会話 (wire.jsonl) を取り出せる。
  同じパスにディレクトリを再作成すれば resume が復活し、会話コンテキストも維持されていた
  (パス一致だけを見ており、git worktree かどうかは見ていない)

### 第 2 ラウンド: 起動方式の決定打 (2026-07-19)

第 1 ラウンド後の設計議論で「worktree 削除時にセッションが resume 不能 + Yuru 上で検出不能になる」
ことが claude/codex との体験の不整合として問題になり、root 起動への転換を検証した。

- **`kimi -p` で作ったセッションは TUI で resume できる**。Claude は `-p` 作成セッションを
  インタラクティブ resume できない制約があったが、kimi にはその制限がない
- **PTY へのメッセージ注入は node-pty で完全に動く**。プロジェクトの依存にある `node-pty` で
  `kimi` を spawn し (spawn 時に `cols`/`rows` を指定するのが鍵。後付けの winsize 変更では
  Enter が効かなかった)、TUI ready 後にテキストを write、数秒後に `"\r"` を write すると、
  ユーザーが打ち込んだのと同じ形でプロンプトが送信される。
  **テキストと Enter は別 write に分ける**こと (TUI の入力処理はチャンク単位で、
  paste-burst と判定された入力の Enter は 120ms 程度抑制される)
- **舵取りを実機確認**: repo root で `kimi` を起動し、Yuru の worktree context プロンプト
  (`src/main/worktree-context-prompt.ts` の文面) を注入したところ、agent は指示どおり
  worktree 配下にファイルを作成し「wt-x で作業する」旨を応答した。
  root 起動 + 注入で、claude/codex と同じ「デフォルトは worktree、跨ぎも可能」を再現できる
- **注入した指示は `wire.jsonl` の turn 0 に残る**。suggested session 検出の確定 evidence として
  使える (workDir 一致 + wire.jsonl の指示文検索の二本立て。adapter の節を参照)

## 設計

### 起動: cwd と作業領域

Claude / Codex は当初 worktree を cwd にして起動していたが、次の経緯から
`cwd: repoPath` 起動 + system prompt 注入 (Claude: `--append-system-prompt`,
Codex: `-c developer_instructions=`) に統一した:

- **要件: worktree を跨ぐ作業が普通にできてほしい** (「別 worktree X のコードをレビューして、
  ついでに直して」など)。root 起動だと workspace が repo 全体 (= 全 worktree を内包) になり、
  注入プロンプトがデフォルトの作業場所だけ worktree に向ける、という形で両立している
- Claude で worktree 起動したセッションは worktree 別ディレクトリに隔離され、
  `--resume` のリストに出なかった
- Codex で既存セッションを別の場所から起動すると確認プロンプトが出てうるさい

Kimi にも同じ 2 要件 (デフォルトは worktree、worktree 跨ぎも自然にできる) を課す。
root 起動で揃えるには指示注入が必須だが、kimi には注入フラグがない。

却下した注入経路:

- `UserPromptSubmit` hook: 設定場所がユーザー級 `~/.kimi-code/config.toml` のみ。
  ユーザー環境へのセットアップを要求するため却下
- `kimi -p "<指示>"` でセッションを作って即 `kimi -S <id>` で TUI attach するプライミング:
  実現は可能 (spike で `-p` 作成セッションが TUI resume できることを確認) だが、
  PTY 注入が動くと分かったため不要になった
- worktree 起動 (`cwd: worktreePath`) で注入自体を不要にする案:
  adapter は最小になるが、**adapter の外に害があった**。worktree を消すと
  resume 不能 (workDir 消失) + Yuru 上で検出不能 (workDir 一致検出のため) になり、
  claude/codex (root 起動なので経緯が残り、main worktree の suggested から復帰できる) と
  体験が崩れる。詳細は次節

採用案: **`cwd: context.repoPath`, `args: []` で起動し、TUI ready 後に
worktree context プロンプトを最初のメッセージとして PTY に打ち込む。**

- PTY への打字は当初「TUI 起動検出のタイミング依存、会話履歴を汚す、新機構」として
  却下していたが、spike 第 2 ラウンドで node-pty による確実な注入と舵取りを実証できたため撤回する
- 打ち込む文面は既存の `src/main/worktree-context-prompt.ts` をそのまま使う。
  claude/codex と同じ指示が、system prompt の代わりに最初のユーザー発言として入る
- 注入した指示は wire.jsonl に残るため、suggested session 検出の確定 evidence になる
  (後述の adapter の節)。会話履歴に見える点は system prompt との差だが、
  「この session はどの worktree の作業か」を後から人間にも追跡できる利点と捉える
- 残る弱み: system prompt と違い会話の一部なので、compaction で指示が薄まりうる。
  claude/codex でも worktree 跨ぎの指示は同じ構造 (会話内の指示) で運用できているため、
  dogfooding で実害を見る

interface への影響: `LaunchRequest.cwd` の意味は「CLI プロセスの起動ディレクトリ
(resume もここで立ち上げる)」のまま変わらず、kimi でも値は claude/codex と同じ repoPath になる。
注入のために `LaunchRequest` に optional の汎用フィールド (例: `initialInput`) を足す。
provider 非依存の仕組みとし、`isWorktreeCwd` のような provider 特化フラグは導入しない
(詳細は「起動時のメッセージ注入」の節)。

「adapter の外で cwd = repo root を前提にしていないか」は実施済み (2026-07-19)。
session cwd の消費箇所は起動 (`service.ts:804`)、metadata 記録 (`:393`, `:1025`)、
resume (`:1197`, `:1288`)、suggested の引き継ぎ (`sessions.ts:102`) の 4 系統で、
すべて「起動/resume 場所」として一貫していた。repo の特定は常に worktreePath / repoId 経由で、
cwd から repo を逆引きするコードはない。renderer には cwd が渡らない
(`PrimarySessionListItem` / `SuggestedSessionListItem` に cwd フィールドなし)。
唯一の repo root 前提は `service.ts:1197` の legacy fallback (cwd 未記録の古い metadata 向け) のみで、
kimi の新規エントリには影響しない。

なお worktree 削除の保護は launch cwd に依存しない。`removeWorktree` はまず
`stopTerminalRuntimesForWorktree` で Yuru 起動の runtime を `worktreePath` キー
(cwd ではない) で止め (`service.ts:501`, `:952-958`)、lsof チェック
(`worktree-process-check.ts`) は Yuru 管理外の外部プロセス向けのバックストップ。

spike の結果、この設計を裏づける事実が確認できた (詳細は「Spike 結果」の節):

- kimi は resume 時に cwd と workDir の一致を強制する (不一致は案内付きの即時エラー。
  確認プロンプトは出ない)。root 起動なら session.cwd = workDir = repo root が常に成り立ち、
  この制約に自然に適合する
- node-pty からの PTY 注入が確実に動き、注入プロンプトで worktree への舵取りが効く
- workspace 外の read / write は hard block されないため、root 起動で workspace が repo 全体に
  広がっても、worktree 跨ぎの要件は claude/codex と同じ形で満たせる

### 起動時のメッセージ注入 (新機構)

Yuru はこれまで session の PTY に打字してこなかったので、これは新しい共通機構になる。

- `LaunchRequest` (shared) に optional `initialInput?: string` を追加。
  provider 非依存のフィールドで、現時点で設定するのは kimi adapter のみ
  (claude/codex はフラグ注入があるので使わない)
- `createWorktreeLaunch` が `initialInput` に worktree context プロンプトを設定する。
  resume (`createResumeLaunch`) では設定しない
- ランタイム側 (`service.ts` の pty.spawn 周辺) は、TUI が入力を受け付ける状態になってから
  テキストと Enter (`"\r"`) を**別 write で**打ち込む (spike 済みの手順:
  テキスト write → 待機 → Enter write。同一チャンクだと paste-burst 扱いで Enter が抑制される)
- **ready 検出**: (a) `waitForSessionId` の index poll が解決した時点
  (実測 ~1.6 秒で TUI は操作可能) を採用。既存の session id 解決フローに自然に乗り、
  実機でも確実に届いた (2026-07-20 確認)
- **自己検証**: 注入後に wire.jsonl (session ディレクトリは session id 解決で特定済み) に
  指示文が現れるまで poll し、現れなければ `recordAppWarning` でエラーセンターに通知する。
  注入が外れた session は指示なしで repo root に居る状態 (= main checkout で作業しうる) なので、
  黙って成功扱いにしない

### worktree 削除と session の寿命

**root 起動の採用により、この問題は解消した。** workDir = repo root なので、
task worktree を消しても session の workDir は存続し、resume はそのまま可能。
体験は claude/codex と揃う:

- worktree を消しても**会話の経緯は全部残り**、resume して「今は worktree2 で作業する」と
  言い直せば続けられる。注入プロンプトが消えた worktree を指しているのは枝葉で、
  「どこが微妙だったか」という議論の経緯こそ引き継ぎの価値であり、それは失われない
- Yuru の UX 上の救済経路も同じ: workDir が repo root (= main worktree) のセッションは、
  紐づく worktree が無くなれば **main worktree の suggested session として再発見**され、
  promote → resume できる

却下した worktree 起動案では、この 2 つが両方失われていた
(workDir = worktree が消えると resume 拒否、かつ workDir 一致検出では Yuru 上どこにも現れない)。
この不整合が root 起動へ倒した決定的な理由。

なお外部で worktree を cwd にして起動された kimi セッション (Yuru 管理外) は
workDir = worktree になるため、worktree 削除で resume 不能になるのは変わらないが、
それはユーザーの明示的な操作の結果であり、Yuru が起動するセッションの設計とは切り分ける。

### adapter (`src/main/agents/kimi/`)

Claude / Codex と同じ 3 ファイル構成 (`index.ts` / `paths.ts` / `worktree-session-detection.ts`) に倣う。

- `definition`: `{ id: "kimi", label: "Kimi" }`、`command: "kimi"`
- `loadStoredSessions`: `session_index.jsonl` を読み、各行の `state.json` から title/timestamp を取る
- `loadStoredSessionPreview`: `state.json` の `title` / `lastPrompt`
- `loadWorktreeSessionHints`: 2 系統の evidence を使う
  - **workDir 一致**: index の `workDir` を realpath 正規化して worktree パスと比較。
    これに一致するのは外部で worktree を cwd にして起動されたセッション (Yuru 管理外)
  - **注入プロンプトの検索**: workDir = repo root のセッション (= Yuru 起動) は、
    wire.jsonl に注入した worktree context プロンプト (worktree パスを含む) が
    turn 0 に残っているので、それを検索して worktree と対応付ける。
    検索は**注入マーカー行 (`WORKTREE_CONTEXT_PROMPT_MARKER` = デフォルトテンプレートの
    第 1 文) に限定**する。実装当初は path の言及全般を evidence にしていたが、
    「別 worktree について会話しただけ」のセッションが suggested に出る誤検知が
    実機確認で出たため絞った (注入文面は Yuru が生成する定型なので確定 evidence になる)。
    ユーザーがテンプレートをカスタムしてマーカー文を消した場合は
    workDir 一致のみの検出に落ちる (Yuru 起動セッションは worktree に紐づかなくなる)
- `createResumeLaunch`: `cwd: session.cwd` (= repo root), `args: ["--session", id]`
- `createWorktreeLaunch`: `cwd: context.repoPath`, `args: []`,
  `initialInput: <worktree context プロンプト>` (注入機構は「起動時のメッセージ注入」の節)
- `waitForSessionId` / `resolvesSessionIdLazily`: Claude 型 (`false`) を採用。
  index への追記が起動直後 (実測 ~1.6 秒、プロンプト入力前) なので、IPC を await してよい。
  起動前に該当 workDir の既存 session id を snapshot し
  (`LaunchRequest.existingProviderSessionIds`、Codex が使っている既存の仕組み)、
  index に新規エントリが現れるまで poll する。
  この解決完了が注入の ready 合図 (a) 案の根拠にもなる

activity 検出はターミナル出力ベースで provider 非依存のため変更不要。

### 変更が必要な既存箇所 (provider 追加の定型)

- `src/shared/session.ts:1` — union に `"kimi"` を追加
- `src/main/agent-registry.ts` — `sessionProviders` に登録 (Record 型なので登録漏れは型エラーになる)
- `src/main/metadata.ts:178` — `parsePrimarySession` の provider バリデーション (直書き)
- `src/renderer/utils/session.ts` — `providerLabel()` の switch (exhaustive check で検知される)
- `src/renderer/style.css` — `.provider-kimi` のドット色 (通常/active/suggested の4ブロック)。
  色は**薄い灰色** (決定済み)

(`terminal-env.ts` は変更不要。kimi はネスト検知 env を設定しないことを spike で確認済み)

New Session ボタン (`TerminalSessionStart.tsx`) と provider 一覧 (`getSessionProviders`) は
registry 登録だけで自動的に増える。

### 変更が必要な既存箇所 (注入機構)

「起動時のメッセージ注入」の新機構として、provider 追加の定型とは別に以下が必要:

- `LaunchRequest` (shared) に `initialInput?: string` を追加
- `src/main/initial-input.ts` (新規) — テキスト + Enter の別 write 打ち込みと
  自己検証 poll の本体。Electron 非依存のモジュールとして切り出し、unit test 可能にした
- `service.ts` — session id 解決 (`startSession` / `resolveLazySessionId`) を合図に
  `initial-input.ts` を呼ぶ。自己検証が timeout したら `recordAppWarning` で
  エラーセンターに警告を出す (黙って成功扱いにしない)。打ち込み先は Yuru が管理する
  PTY なので、注入は Yuru 起動セッションにだけ発生する

### テスト

- `test/main/sessions.test.mjs` — kimi fixture (tmp の `KIMI_CODE_HOME` 相当) を追加
- `test/main/worktree-session-detection.test.mjs` — workDir 一致判定と、
  wire.jsonl の注入プロンプト検索による worktree 対応付け
- `test/main/metadata.test.mjs` — バリデーションに kimi を許可
- 注入機構の unit test — `initialInput` が LaunchRequest からランタイムに届くこと、
  テキストと Enter が別 write になること (pty は mock でよい)
- `test/e2e/provider-session.test.ts` — `providers` に kimi のパラメータセットを追加。
  隔離は `KIMI_CODE_HOME` を tmp に向ける (HOME 偽装だけでもよいが、専用 env があるのでそちらが確実)。
  資格情報の seed は**実 `~/.kimi-code/credentials/` (必要なら `oauth/` も) のコピー**で行う
  (API key は使わない。このセッションと同じ OAuth 認証情報を流用する)。
  セキュリティ要件: tmp KIMI_CODE_HOME は 0700、コピーした credentials/oauth は
  元のパーミッション (0700/0600) を維持、repo や fixture には一切置かない、
  ログに内容を出さない、テスト終了後に削除する
- `test/e2e/helpers.ts` の `MetadataSeed.provider` の直書き union を `SessionProvider` 型に寄せる

## provider ハードコードの局所性評価

現状はかなり良い。registry (`Record<SessionProvider, SessionProviderAdapter>`) と
exhaustive switch が「追加時に型エラーで気づける」構造になっており、
main 共通部 (sessions.ts / service.ts / repo-list.ts) と renderer のボタン生成は登録だけで動く。

型で検知できず実行時まで気づけない直書きが 2 箇所ある。Kimi 追加の**前に**小さく直すのが得策:

1. **`src/main/metadata.ts:178` のバリデーション**
   `provider !== "claude" && provider !== "codex"` のリテラル比較。
   `src/shared/session.ts` に provider id の配列 (`SESSION_PROVIDER_IDS as const`) を置き、
   union 型をそこから導出する形にすれば、ここも配列参照にできて単一の追加箇所になる
2. **`src/main/terminal-env.ts` の provider 分岐**
   `provider === "codex"` で消す env を切り替えている (Claude 分は無条件削除)。
   「起動時に消すべき env マーカー」を各 adapter の責務にし
   (例: adapter が `envMarkersToClear: string[]` を返す)、terminal-env は全 adapter の宣言を畳むだけにすると、
   ネスト検知 env の知識が provider ごとのディレクトリに収まる

一方で無理に抽象化しない方がよいもの:

- `providerLabel()` の switch と style.css のドット色は、追加時に型エラー/一目で分かる場所にあり、
  定義を registry に集約するほどの害はない。今回は既存パターンに倣って case と CSS を足すだけにする

## エージェント向けハーネス (Kimi でこの repo を開発する観点)

- **AGENTS.md**: kimi はプロジェクトの AGENTS.md を読む (このセッションで確認済み)。
  現状の内容で問題ない。e2e の注意書きは Codex sandbox 固有の話なので、kimi 特有の運用上の問題が
  出てから追記すればよい (YAGNI)
- **プロジェクトローカル設定**: kimi は `<project>/.kimi-code/local.toml` (workspace 追加 dir) と
  `.kimi-code/mcp.json` を読む。現時点で Yuru repo に必要な設定はない。
  将来使うことになったら `.gitignore` に `.kimi-code/local.toml` を足す (公式も推奨)
- **ユーザーレベル (`~/.kimi-code`)**: Yuru 実行のために追加で必要なものはない
  (login 済みの credentials がそのまま使われる)。Yuru から起動する kimi session 用に
  グローバル AGENTS.md (`~/.kimi-code/AGENTS.md`) を用意する必要も今のところない。
  worktree 運用は Yuru 側の起動設計 (root 起動 + 起動時のメッセージ注入) で担保する
- **permission mode**: デフォルト manual のため承認プロンプトは PTY 上にそのまま出て操作できる。
  Yuru 側からフラグを渡す必要はない

## タスク

1. ~~Spike (実機確認)~~ → 実施済み。全項目クリア (「Spike 結果」の節を参照)。
   index 追記 ~1.6 秒、workDir 記録、resume は cwd 一致必須 (エラーは即時・案内付き)、
   workspace 外 read/write は block されず、env マーカーなし、
   PTY 注入 (node-pty) と舵取りを実証
2. ~~監査: `PrimarySessionMetadata.cwd` / `LaunchRequest.cwd` の消費箇所~~ → 実施済み。
   「cwd = repo root」前提のコードはなく設計変更不要 (起動設計の節に結果を記録)
3. ~~事前リファクタ: provider id 配列を shared に集約~~ → 実施済み。
   `SESSION_PROVIDER_IDS` (`src/shared/session.ts`) を導出元にし、
   metadata バリデーションと e2e helpers の直書き union をそこに寄せた
4. ~~注入機構~~ → 実施済み。`LaunchRequest.initialInput` + `src/main/initial-input.ts`
   (別 write 打ち込み + 自己検証 poll) + service.ts 配線 (失敗時は `recordAppWarning`)
5. ~~`src/main/agents/kimi/` adapter 実装 + registry 登録 + union 追加~~ → 実施済み
6. ~~UI: providerLabel case と `.provider-kimi` の CSS~~ → 実施済み (薄い灰色)
7. ~~unit test (sessions / worktree-session-detection / metadata / 注入機構 /
   kimi-provider)~~ → 実施済み。「`~/.kimi-code` が存在しない時に空を返し、
   他 provider の一覧を壊さない」も kimi-provider.test.mjs で担保
8. ~~実機確認~~ → 実施済み (2026-07-20)。新規 session (注入の舵取り: worktree 内に
   ファイル作成) / resume / suggested 検出 (workDir 一致 + 注入マーカー検索) /
   worktree 跨ぎ (別 worktree の読み取り) を確認。
   言及ベース検出の誤検知が見つかり、注入マーカー行限定に修正済み →
   **ここまでで main にマージし、dogfooding 開始**
9. (マージ後) e2e: provider-session.test.ts への kimi 追加 (KIMI_CODE_HOME 隔離 + 資格情報 seed)

## マージライン

完璧でなくてよいが、「後で大前提が狂って大きな戻りが出ない」状態でマージする。
大前提とは永続化データの形式・adapter インターフェース・起動 cwd 方針の 3 つで、
これらは spike (タスク 1、実施済み) と監査 (タスク 2、実施済み) で固定した。

マージの条件:

- ~~spike 全項目が設計どおりであること~~ → クリア済み (「Spike 結果」の節を参照)
- kimi adapter が既存 provider を巻き込まないこと。sessions.ts は全 adapter を `Promise.all` で
  回すため、kimi adapter の例外は claude/codex の一覧表示まで壊す。
  「store が無ければ空を返す」(claude adapter と同じ existsSync 契約) を test で担保する
- 注入機構が既存 provider に影響しないこと。`initialInput` は optional で、
  設定しない provider (claude/codex) の起動フローは変わらない
- 実機確認で「注入が外れたまま黙って使われる」状態にならないことを確認する
  (自己検証の警告が出ること)。注入が外れた session は指示なしで repo root に居るため、
  main checkout で作業されうる唯一の新規リスク
- 既存テストが全緑 (claude/codex e2e 含む)

戻りが起きない根拠:

- dogfooding 中に書かれる metadata (`provider: "kimi"`, `cwd: repoPath`) は claude/codex と
  同じ形で、後から起動方針や注入文面を変えてもそのまま使える (resume は記録された cwd を使うだけ)
- 実際、今回の方針転換 (worktree 起動案 → root 起動 + 注入) が
  「起動方針の変更は adapter と注入機構に閉じ、metadata 移行は不要」であることの証明になった
- union 追加と registry 登録は additive で、既存 provider の振る舞いは変わらない

マージ後に積むもの: kimi 用 e2e (資格情報 seed の方針は決定済み、テストの節を参照)、
suggested 検出や preview の精度、ドット色の最終調整、注入の自己検証の UI 通知化、
compaction での指示の薄まりへの対処
(実害が出たら注入文面の工夫か kimi 側への `--append-system-prompt` 相当の要望)。
これらは局所修正で済むため dogfooding しながら直す。

## Open questions

- compaction で注入した指示が薄まる度合い (dogfooding で観察)

## 決定済み (旧 Open questions)

- 注入の ready 検出 → **session id 解決を合図にする (a) 案を採用**。
  kimi の index 追記は TUI ready とほぼ同時 (実測 ~1.6 秒) で、実機でも確実に届いた
- 注入失敗を検出した後の扱い → **`recordAppWarning` でエラーセンターに UI 通知**する
  (ログのみだと気づけないため)
- 注入メッセージが会話履歴にユーザー発言として見えること → 実機で確認、
  「この session はどの worktree の作業か」が追跡できる利点として許容
- kimi のドット色 → **薄い灰色**
- e2e の資格情報 seed → **API key は使わず、実 `~/.kimi-code` の OAuth 認証情報
  (`credentials/`、必要なら `oauth/` も) を tmp KIMI_CODE_HOME にコピーする**。
  パーミッション維持・repo に置かない・ログに出さない・後始末、の条件付き (テストの節を参照)
