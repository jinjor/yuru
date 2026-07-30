# F48 詳細設計: エージェントからの worktree + session 作成 API

Last updated: 2026-07-30

[F48-branch-work.md](F48-branch-work.md) の方向性 (handoff、API + 組み込み skill、Unix domain socket、
中立性の原則) を土台に、スパイク結果と実装レベルの設計をまとめたもの。
実装はこのドキュメントの「実装ステップ」に沿って 1 ステップずつ委譲・検品する。

## スパイク結果 (2026-07-30 実施)

検証環境: macOS (arm64)、Claude Code 2.1.220、Codex CLI 0.145.0、Kimi Code CLI 0.29.2。
「検証済み」は実機で provider を動かして確認したもの、「ドキュメント」は公式ドキュメント由来。

### skill の読み込み経路

| provider | 使える経路 | 結果 |
|---|---|---|
| Claude | `--plugin-dir <dir>` (起動引数、repeatable、session のみ有効) に plugin 形式 (`<dir>/.claude-plugin/plugin.json` + `<dir>/skills/<name>/SKILL.md`) で置いた skill | 検証済み: モデルが Skill tool から呼べた |
| Claude | `~/.agents/skills/` | 検証済み: **読まれない** |
| Codex | `$CODEX_HOME/skills/` (= `~/.codex/skills/`) | 検証済み: 読まれる |
| Codex | `~/.agents/skills/` | 検証済み: 読まれる |
| Kimi | `~/.agents/skills/` (user scope としてスキャン) | 検証済み: 読まれる |
| Kimi | `config.toml` の `extra_skill_dirs` | 検証済み: 読まれる (が、ユーザー設定の編集が要るので不採用) |
| Kimi | `--skills-dir` | 不採用。auto-discovered (user/project) を**置き換えてしまう** (公式ドキュメント) |

結論: **`~/.agents/skills/yuru/` に実体化すれば Codex と Kimi は設定不要**。
Claude は Yuru が起動引数を握っているので `--plugin-dir` を足す (ユーザー設定に触らない)。
いずれも F48-branch-work.md の候補 (b) 相当だが、触るのは共有の標準ディレクトリ
`~/.agents/skills` 配下の `yuru/` サブディレクトリだけで、各 provider の設定ファイルは編集しない。

### socket 接続と sandbox

Unix domain socket への接続を provider のシェル実行から試した結果。

| provider | 結果 |
|---|---|
| Claude | 検証済み: 接続できる (デフォルトでは OS レベルの sandbox なし。Bash の permission はユーザー設定次第) |
| Kimi | 検証済み: 接続できる (sandbox なし。`-p` 非対話でもコマンド実行できた) |
| Codex | 検証済み: デフォルトの seatbelt sandbox で `connect EPERM`。**AF_UNIX も TCP loopback も両方拒否される** |

Codex の回避策を調べた結果:

- `permissions.<id>.network.unix_sockets` の設定形式はあるが、seatbelt の SBPL に反映されない
  上流バグ ([openai/codex#25416](https://github.com/openai/codex/issues/25416)) が
  0.145.0 でも未修正 (config.toml / `-c` 両方で検証済み)
- `--allow-unix-socket` フラグは `codex sandbox` サブコマンドにだけあり、
  TUI / `codex exec` にはない
- 今日動く唯一の設定レバーは legacy 設定 `sandbox_mode = "workspace-write"` +
  `[sandbox_workspace_write] network_access = true` (検証済み。
  `-c sandbox_mode="workspace-write" -c sandbox_workspace_write.network_access=true`
  でも効く)。ただしこれは **ネットワーク全体を開く**
- 一方で TUI の承認の仕組み自体は残っている (バイナリ内のエージェント指示で確認):
  sandbox に拒否されたコマンドは、エージェントが `require_escalated` (sandbox なし実行)
  + 理由を付けて再実行し、ユーザーが TUI で承認できる。承認はコマンドの prefix 単位で
  session 中再利用できる (`approve_for_session`)。
  さらに `approvals_reviewer` という設定があり、approval の判断を `auto_review`
  (サブエージェントによる自動審査) に回すこともユーザー設定でできる
- ただし TUI のモード切り替えには「workspace-write + ネットワークあり」の中間はない
  (read-only / workspace / full-access の 3 択で、workspace のネットワーク有効化は
  config.toml でしかできない)。「`network_access = true` 相当を TUI で一度だけ承認」
  という形はなく、TUI での承認はコマンド単位 (または sandbox ごと外す full-access) になる

Codex 対応は設計判断が要るので「相談事項」に分離した (後述)。

### スラッシュ起動形式

- Claude: plugin の skill は Skill tool から名前で呼べる (検証済み)。
  スラッシュ補完上の見え方 (`/yuru` か `/plugin名:yuru` か) は未検証。実装時に確認する
- Codex: skill は自動選択または `$<name>` メンション (公式の Agent Skills 仕様)。
  `/skill:...` 形式ではない
- Kimi: `/skill:<name>` (公式ドキュメント)

方向性どおり「自然言語で『yuru で分岐して』がどの provider でも効く」を本位にし、
スラッシュ形式の差はベストエフォートとする。skill の `description` に
「yuru、worktree の分岐、別セッションへの作業依頼」系の語を入れて自動選択を拾いやすくする。

## 設計

### 全体構成

```
エージェント (PTY 内)
  └─ node "$YURU_CLI" <command>        … scripts/yuru-cli.mjs (薄いクライアント)
        └─ Unix socket ($YURU_API_SOCKET) … NDJSON request/response
              └─ Electron main の API server (新規: src/main/api-server.ts)
                    └─ YuruService の公開メソッド (worktree 作成 / session 開始 / transcript path 解決)
```

- 公開契約は CLI の入出力だけ。socket の wire protocol は内部実装
- ロジックはすべて main process に置き、CLI は socket に投げて結果を表示するだけにする
  (CLI に Git / metadata 操作を持たせない。`yuru add` のような直接 metadata 書き込みは増やさない)
- 認証は作らない (socket ファイル 0600。方針は F48-branch-work.md どおり)

### API server (main process)

新規ファイル `src/main/api-server.ts` に Node `net` サーバとして実装する。

- socket path: `~/.yuru/run/<pid>.sock` (YURU_HOME 上書きに追随)。
  複数インスタンス (F33) は pid で自然に分かれる。listen 後に `chmod 0600`
- 起動: `src/main/index.ts` の `app.whenReady()` 内 (`registerIpcHandlers()` 近辺) で listen
- 停止: `stopApplicationServices()` で close し、socket ファイルを削除。
  クラッシュで残った stale socket は、起動時に `~/.yuru/run/` の自分の pid 以外のファイルを消せばよい
  (pid 生存確認まではしない。消して害にならない: 生きている他インスタンスの socket は
  そのインスタンスの pid 名なので対象外にできる)
- プロトコル: 1 接続につき JSON 1 行を受け取り、JSON 1 行を返す (NDJSON)。
  リクエスト: `{ "command": string, "args": object }`。
  レスポンス: 成功 `{ "ok": true, "data": ... }` / 失敗 `{ "ok": false, "error": { "code", "message" } }`
- コマンドは `YuruService` に追加する公開メソッドへの薄いマッピングにする。
  既存の `Result<T>` 規約に乗せ、例外は IPC ハンドラと同じ要領で error レスポンスに変換する
- renderer への反映: 呼ぶのが既存の service メソッドなので、既存の events / WorktreeWatcher
  経由の更新がそのまま効く (新規の通知経路は作らない)

提供するコマンド (CLI サブコマンドと 1:1):

1. `worktree create <branchName>`
   - 呼び出し元の repo を特定し、`YuruService.createTaskWorktree(repoPath, branchName)` を呼ぶ
   - repo の特定: CLI が env の `YURU_WORKTREE_PATH` を送る → main 側で
     metadata の `repos` + Git worktree 一覧から、その worktree を含む repo を引く
     (PTY ごとに env を注入するので、複数 repo を開いていても曖昧にならない)
   - 応答: `{ worktreePath, branchName }`
2. `session create --worktree <path> --provider <claude|codex|kimi> [--prompt-file <path> | --prompt <text>]`
   - 指定 worktree で provider session を開始する。内部は `createSessionForWorktree` と同じ流れ
     (後述の initialPrompt 対応を含む)
   - prompt は「最初のユーザーメッセージ」として投入する (後述)。
     `--prompt-file` は CLI がファイルを読んで中身を送る (main はファイルを読まない)
   - 応答: `{ worktreePath, provider }` (provider session id は取れたら添える。lazy な provider は null)
3. `session transcript-path [--worktree <path>]`
   - 対象 worktree の primary session の会話ログ (JSONL) の絶対パスを返す。
     `--worktree` 省略時は呼び出し元の `YURU_WORKTREE_PATH`
   - Yuru は中身を読まずパスだけ返す。読むのはエージェント (= 「セッションを読む」primitive。
     会話フォーマットを公開契約にしない)
   - パス解決ロジックは各 provider adapter に既にある (`findClaudeSessionFile` など。
     `src/main/agents/<provider>/index.ts` 内部) ので、adapter の公開面に 1 メソッド足す
   - primary がない / session id 未解決 / ファイルなし はエラー応答

どのコマンドも用途 (分岐・レビュー) を名乗らない。命名は中立に `worktree` / `session` の語だけ使う。

### CLI

`scripts/yuru-cli.mjs` にサブコマンドを足す (依存ゼロの ESM のまま、`node:net` で socket に繋ぐ)。

- 接続先は env `YURU_API_SOCKET` だけを見る。未設定なら
  「Yuru のセッション内から呼ばれていない」旨のエラーで終了 (yuru 外の素のシェルでは繋がらないのが正しい挙動)
- 新しいサブコマンドは既存の `open` / `add` / `latest` とは別系統なので、
  socket が要るコマンド群として分かるように実装する
- 出力は人間が読める 1 行結果 + エラーは stderr + exit 1。機械可読性が要るほどのものはない
  (受け手はエージェントで、エラーメッセージを読んで判断する)

エージェントからの呼び方は `node "$YURU_CLI" ...` に統一する (`YURU_CLI` は PTY に注入、後述)。
`yuru` コマンドが PATH にあるかはユーザーの環境次第なので、skill は `$YURU_CLI` 経由だけを教える。

### PTY への環境変数注入

注入箇所は `src/main/terminal-env.ts` の `createTerminalEnv()`。
session 系・standalone 両方の PTY 起動がここを通る。

- `YURU_API_SOCKET`: 全 PTY に注入 (そのインスタンスの socket path)
- `YURU_CLI`: 全 PTY に注入。`scripts/yuru-cli.mjs` の絶対パス。
  開発時は app root 配下のもの。パッケージ版 (`scripts/package-local-app.mjs`) では
  app bundle に `yuru-cli.mjs` を同梱してそのパスを指す (同梱の仕組みがなければ足す)
- `YURU_WORKTREE_PATH`: task worktree の session / terminal にだけ注入
  (repo の逆引きと `session transcript-path` のデフォルト引数に使う)。
  main worktree の standalone terminal には入れない (task worktree ではないため)

provider session id の env 注入は **しない** (F48-branch-work.md の未決をこう決める)。
Codex のように session id が遅れて解決する provider では PTY 起動時に値が決まらず、
入れられない provider が出ると中途半端なので。session の特定は `YURU_WORKTREE_PATH` →
metadata の primary → adapter のパス解決、という API 側の導出に寄せる。

### skill の配置・マテリアライズ

- 原本: この repo の `skills/yuru/SKILL.md` (新規)。ビルド成果物ではなくソースとして管理する
- app 起動時 (`whenReady`) に次の 2 箇所へ実体化する。どちらも**常に上書き**
  (skill と API の世代をずらさない。F48-branch-work.md の方針どおり)
  1. `~/.agents/skills/yuru/` (Codex / Kimi 用)
  2. `~/.yuru/plugin/` (Claude 用 plugin 形式: `.claude-plugin/plugin.json` + `skills/yuru/SKILL.md`)
- パッケージ版でも原本を同梱できるよう、skill 原本は app の resources に含める
- skill の中身は API の使い方のみ: `node "$YURU_CLI" worktree create ...` の各コマンド、
  引数、エラーの意味、Codex での制約 (後述)。ユースケース・handoff の書き方は書かない
  (中立性の原則)
- `yuru` という名前は予約。ユーザーのカスタム skill は別名で同じ場所に置く運用を
  skill の末尾に 1 行だけ書く

Claude の起動引数への `--plugin-dir` 追加:

- `src/main/agents/claude/index.ts` の `createWorktreeLaunch` と `createResumeLaunch` の
  両方に `--plugin-dir ~/.yuru/plugin` を足す (新規・resume のどちらのセッションでも使えるように)
- `--plugin-dir` は session のみ有効でユーザーの plugin 設定を汚染しない

### initial prompt (handoff) の投入

`session create` の prompt は「session の最初のユーザーメッセージ」として入れる。
provider ごとにネイティブな経路を使う (adapter が差を吸収する既存の形に乗せる):

- Claude: 起動引数の positional prompt (`claude [prompt]`)。
  `--append-system-prompt` (worktree context) と併用する
- Codex: 起動引数の positional prompt (`codex [PROMPT]`)。`-c developer_instructions=...` と併用
- Kimi: positional がないので、既存の initialInput の仕組み
  (`src/main/initial-input.ts` の `deliverInitialInput`) で PTY に打ち込む。
  Kimi は worktree context も initialInput で入れているので、context 投入の後に続けて入れる

実装上は、`createWorktreeLaunch` の context (`LaunchRequest`) に optional の
`initialPrompt` を足し、各 adapter が自分の方式で launch args / initialInput に畳み込む形が自然。
positional prompt の shell エスケープは既存の `buildShellExecCommand`
(`src/main/shell-launch.ts`) がシングルクォートで処理しているので、その経路に乗せる。

失敗時の扱い: prompt の投入は session 開始の一部で、投入失敗 = session 開始失敗とはしない。
Kimi の context 投入と同じく「記録されたか検証できる provider は検証し、
だめなら warning を出す」既存の流儀に合わせる。

handoff をファイルとして残すかどうかは **Yuru の関知するところではない** (未決をこう決める)。
CLI は `--prompt-file` でファイルの中身を受け取るだけで、そのファイルをどこに置くか、
残すか捨てるかは呼び出し側 (ユーザー層の skill / プロンプト) が決める。

### Codex sandbox 問題への対応

設計としては「Yuru は Codex の sandbox 設定に触らない」をデフォルトにする。

- Yuru が全 Codex セッションに `network_access = true` を黙って注入すると、
  ユーザーの sandbox ポリシー (ネットワーク遮断) が Yuru 経由の起動でだけ変わってしまう。
  これは勝手にやるべきでない
- 何もしなくても TUI では sandbox 拒否されたコマンドの昇格実行をユーザーが承認できる
  (Codex の approval の仕組み)。エージェントは拒否を検知すると `require_escalated` 付きで
  自動で再実行し、ユーザーは 1 回押すだけ。同じコマンド prefix は session 中の再承認も不要にできる。
  完全自律にはならないが、使えないわけではない
- 自律に近づけたい場合の選択肢はユーザー設定側にあり、`approvals_reviewer = "auto_review"`
  (approval の判断をサブエージェントに委譲) を使うか、`config.toml` に
  `network_access = true` を書くかになる。どちらも Yuru は関与しない
- skill には事実だけ書く: 「Codex では sandbox が socket 接続を拒否することがある。
  その場合は昇格実行の承認をユーザーに求めよ。ユーザーが事前にネットワークを許可
  していればそのまま使える」
- 上流バグ #25416 が直れば `permissions.<id>.network.unix_sockets` で socket だけ許可できる。
  直ったら Yuru が `-c` でその設定だけ注入する、という綺麗な解決に乗り換えられる

これはセキュリティポリシーの判断なので、最終決定はユーザーに委ねる (後述の相談事項)。

## 実装ステップ

各ステップは独立して実装・検品できる順に並べた。
共通の約束: ユニットテストは `test/main/*.test.mjs` に TS ソースの直接 import で書く
(既存の `initial-input.test.mjs` などと同じ流儀)。変更後は `npm run build` + `npm test`。
動作確認はこの worktree から `npm run app:restart` した app で行う。

### Step 1: API server の骨格 + env 注入 + CLI の往復

- `src/main/api-server.ts` を新規作成: `~/.yuru/run/<pid>.sock` に listen、0600、
  NDJSON で 1 リクエスト 1 レスポンス、未知コマンドはエラー応答。
  起動・停止・stale 掃除を `src/main/index.ts` に配線
- `createTerminalEnv()` に `YURU_API_SOCKET` / `YURU_CLI` / `YURU_WORKTREE_PATH` を追加
  (`YURU_WORKTREE_PATH` は task worktree のみ。呼び出し側の service.ts で分岐が要るか確認)
- `scripts/yuru-cli.mjs` に `ping` サブコマンド (socket に繋いで `pong` を表示するだけ)
- テスト: api-server のハンドラ単体テスト (mock service)。手動確認: Yuru の terminal で
  `node "$YURU_CLI" ping` → `pong`、素のシェルで同じコマンド → エラー

### Step 2: `worktree create`

- service に API 用の公開メソッド (呼び出し元 worktree path から repo を引いて
  `createTaskWorktree` に繋ぐ) を追加
- CLI に `worktree create <branchName>` を追加
- テスト: repo 解決の単体テスト。手動確認: Yuru の Claude セッションの中から
  新しい branch の worktree を作り、左ペインに現れること

### Step 3: `session create` + initial prompt

- `LaunchRequest` / adapter に `initialPrompt` (optional) を追加し、
  Claude (positional) / Codex (positional) / Kimi (initialInput 2 発目) に実装
- service の API メソッドと CLI `session create` を追加
- テスト: 各 adapter の launch args 組み立ての単体テスト (既存テストの流儀に倣う)。
  手動確認: セッション内から `session create --prompt` で子セッションが立ち、
  最初のメッセージとして prompt が入っていること (3 provider)

### Step 4: skill のマテリアライズ + Claude の `--plugin-dir`

- `skills/yuru/SKILL.md` を作成 (API の使い方のみ)
- 起動時に `~/.agents/skills/yuru/` と `~/.yuru/plugin/` へ上書きコピーする処理
- Claude adapter の新規・resume 両方に `--plugin-dir` を追加
- 手動確認: 3 provider のセッションで「yuru の skill を使って worktree を作って」が通ること。
  Claude でスラッシュ補完の見え方を確認してドキュメントに追記

### Step 5: `session transcript-path`

- adapter 公開面に transcript path 解決を追加 (既存の内部関数を公開)
- service / CLI に `session transcript-path` を追加
- テスト: path 解決の単体テスト。手動確認: 子セッションから親の
  `session transcript-path` を取り、その JSONL を読めること

### Step 6: Codex の sandbox 対応 (実機検証)

- 方針は決定済み (Yuru は何も注入しない。skill に事実を書いて終わり)
- 残るのは TUI の実機検証。バイナリ内の指示文からの確認で、実際の TUI の挙動は未検証:
  - `require_escalated` での再実行 → 承認プロンプトが出ること
  - 承認の prefix 再利用 (`approve_for_session`) で同じ CLI 呼び出しが
    session 中 2 回目以降は承認なしで通ること
  - ユーザーの `approval_policy` によっては昇格リクエスト自体が拒否される
    (バイナリ内に "you cannot ask for escalated permissions if the approval policy is ..."
    という文言がある)。デフォルト以外の policy ではどうなるか
- 上流 #25416 の修正状況は実施時点で再確認する

### 後回し (この設計のスコープ外)

- レビュワーを同じ worktree の 2 つ目の session として立てる件。
  「1 task worktree に最大 1 primary session」との関係の設計が要るので別途決める。
  それまではレビューも新規 worktree で立てる運用 (レビュー用 worktree の無駄は残るが、
  分岐と pull 型レビューの両方は成立する)

## 相談事項 (ユーザー判断が要るもの)

1. **Codex の sandbox**: **決定 (2026-07-30)**: Yuru は何も注入しない。
   この仕組みはユーザーが指示したときに使うものなので、TUI での承認が挟まるのは
   苦でなく、寧ろユーザーに見える形で良い。`network_access = true` のような
   セッション全体を開く設定は Yuru 側からは用意しない (ユーザーが自分の
   config.toml でやる分には自由)
2. **`~/.agents/skills/yuru/` への配置**: **決定 (2026-07-30)**: 配置してよい。
   このディレクトリは Codex / Kimi 以外のツールも読みうる共有の場所だが、
   `yuru/` サブディレクトリに限定して置く
3. **Claude の `--plugin-dir`**: **決定 (2026-07-30)**: 追加してよい。
   resume を含む全 Claude セッションの起動引数に `--plugin-dir ~/.yuru/plugin` が恒久的に付く
