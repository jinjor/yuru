# F59 詳細設計: 各プロバイダの利用状況を表示する

Last updated: 2026-08-09

取得方法の調査結果と、実際に 3 provider から値を取れることの確認は
F59-provider-usage-spike.md に記録がある。

## 何が問題か

Claude / Codex / Kimi はどれもサブスクリプションのプランで動いていて、
5 時間枠と週枠のリミットがある。今どれだけ使ったかを知るには、各 CLI の中で
`/usage` 相当を叩くしかない。つまり:

- セッションを開いていない provider の残量は確認できない
- 確認するには作業中のセッションから目を離して別のことをする必要がある
- 3 つ並べて「今どれで作業を始めるべきか」を比べられない

Yuru は 3 provider を横断して作業を回す道具なので、この情報こそ常時見えていてほしい。

## 設計の要約

- 各 provider の CLI を **セッションを作らない形** で起動し、provider 自身が持っている
  公式の利用率をそのまま取得する。Yuru は認証情報を一切扱わない
- **モデル呼び出しは起きない**。つまりこの機能自体はトークンを消費しない。
  3 provider とも実測で確認済み (spike のメモ参照)
- 表示するのは「5 時間枠 / 週枠の、使用率 (%) と次のリセットまでの残り時間」。
  内部では **リセット時刻を絶対時刻で持つ**。Kimi だけは相対表現しか返さないので、
  取得時刻から絶対時刻に直して揃える (後述)
- 置き場所は sidebar のフッタ、Errors 行の上。worktree に紐づかない
  アプリ全体の情報として扱う
- 取得はウィンドウがフォーカスされている間だけ 60 秒ごと。既存の PullRequestMonitor
  (PR の状態を定期取得して renderer に push する仕組み) と同じ形にする
- **インストールされていない provider は、利用状況の行にも新規セッションの選択肢にも
  出さない。** 同じ判定結果で両方を制御する
- 取得できなかった provider は値を消し、その理由を行に出す。
  前回値の再利用・リトライ・「取れなかったので 0%」といった代替値は作らない
- **未インストールと未ログインはエラーではない**。それ以外の失敗だけを error center に記録する

## 取得方法

3 つとも「その CLI に既にログインしていれば、追加の準備なしで動く」。
認証情報を読むのは各 CLI 自身であり、Yuru は Keychain もトークンファイルも触らない。
Yuru が REST を直接叩く案は採らない。Electron 本体が Keychain を読むと macOS の
許可ダイアログが出るうえ、アクセストークンの期限切れ時に Yuru がリフレッシュすると
CLI 側のログインを壊しうるため。

### claude

```
claude --print --safe-mode --input-format stream-json --output-format stream-json --verbose
```

を起動し、標準入力に 1 行流して `control_response` を 1 つ受け取ったら終了させる。

```json
{"type":"control_request","request_id":"usage_1","request":{"subtype":"get_usage"}}
```

返り (抜粋):

```json
{"rate_limits":{"five_hour":{"utilization":28,"resets_at":"..."},
                "seven_day":{"utilization":13,"resets_at":"..."}},
 "session":{"total_cost_usd":0,"model_usage":{}}}
```

- この `get_usage` は内部で `GET /api/oauth/usage` を叩く。モデル応答のヘッダ待ちではないので、
  セッションが動いていなくても最新値が返る
- `--safe-mode` でユーザーの hooks / plugins / CLAUDE.md を読ませない
- transcript も `history.jsonl` も `~/.claude/sessions/<pid>.json` も作られないことを確認済み。
  Yuru のセッション一覧 (`history.jsonl` を起点に組み立てる) には出ない
- **`get_usage` は CLI 内部で "Experimental — the response shape may change" と
  明記されている。** 形が変わる前提で扱う (失敗時の挙動は後述のとおり「出さない」)

素の CLI 引数だけで済む `claude -p "/usage"` も同じくトークンを消費しないが、採らない。
返るのが表示用テキストなのでパーセントを文字列から取り出すことになり、
かつ実行のたびに空の transcript ファイルが 1 個残る
(Yuru の worktree 推測は `~/.claude/projects` 全体を ripgrep するので、増えるほど遅くなる)。

### codex

`codex app-server` を起動し、stdio の JSON-RPC で 2 往復する。

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"yuru","version":"..."}}}
{"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read"}
```

返り (抜粋):

```json
{"rateLimits":{"primary":{"usedPercent":13,"windowDurationMins":10080,"resetsAt":1786852628},
               "secondary":null,"planType":"plus"}}
```

- スレッド (会話) を作らないので、rollout ファイルも `session_index.jsonl` も
  `history.jsonl` も変化しないことを確認済み
- **Codex は今 5 時間枠を返さない**。`secondary` が常に `null` で、`primary` は
  `windowDurationMins: 10080` (= 週)。ローカルのログを遡ると 5 時間枠 (300 分) は
  2026-07-12 を最後に消えている。UI はこの「枠が存在しない」状態を表現できる必要がある
- `codex app-server` は CLI 上 `[experimental]` 表記

### kimi

ローカルサーバを起動して REST を 1 回叩く。

```
kimi web --no-open --port 0 --log-level error
GET http://127.0.0.1:<port>/api/v1/oauth/usage
Authorization: Bearer <token>
```

`--port 0` を渡すと空きポートが自動で選ばれ、起動時に標準出力へ出る URL
(`http://127.0.0.1:51094/#token=...`) に実際のポートと bearer token が両方入っている。
この 1 行を待つことが起動完了の合図にもなるので、ポートの空き探しも
token ファイルの読み取りも要らない。

返り (抜粋):

```json
{"data":{"summary":{"label":"Weekly limit","used":78,"limit":100,"reset_hint":"resets in 6d 7h 5m"},
         "limits":[{"label":"5h limit","used":86,"limit":100,"reset_hint":"resets in 4h 5m"}]}}
```

- `used` / `limit` は分母 100 なので実質パーセント。`summary` が週枠、`limits[]` に
  5 時間枠が入る
- **リセットは `reset_hint` という表示用の文字列でしか返らない** (絶対時刻は返らない)。
  取り扱いは後述
- bearer token は初回起動時に kimi が自動生成して `~/.kimi-code/server.token` に
  永続化するもので、ユーザーが用意するものではない (標準出力に出る値と一致することを確認済み)
- セッションは作られない (`session_index.jsonl` 無変化を確認)
- ポートは毎回 `:0` で空きを取ってから渡す。取得後は必ずプロセスを終了させる
  (サーバなので放置すると生き続ける)

### ログインしているかの判定

未ログインをエラーとして扱わないために、3 provider とも「ログインしていないだけ」を
構造的に見分ける。文字列マッチはしない。実際にログアウト状態を作って確認した
(Codex は `CODEX_HOME`、Kimi は `KIMI_CODE_HOME`、Claude は `HOME` を空のディレクトリに向ける)。

| provider | 判定 | 追加コスト |
|---|---|---|
| claude | `get_usage` の `rate_limits_available` が `false` (このとき `rate_limits` も `null`)。これは「未ログイン」と「API キー等でプラン外」の両方を含むので、この状態のときだけ `claude auth status --json` を実行し、`loggedIn` で分ける | この状態のときだけ 1 プロセス追加 (実測 0.2 秒) |
| codex | 同じ接続で `account/read` も投げ、`account` が `null` かどうかで判定 | なし (同じ app-server 接続) |
| kimi | 同じサーバの `GET /api/v1/auth` の `managed_provider` が `null` かどうかで判定 | なし (同じサーバ) |

確認した応答:

```
claude  ログアウト時: {"rate_limits_available":false,"rate_limits":null,"subscription_type":null}
        `claude auth status --json` -> {"loggedIn":false,"authMethod":"none"}
codex   ログイン時: {"account":{"type":"chatgpt","email":"...","planType":"plus"}}
        ログアウト時: {"account":null}
kimi    ログイン時: {"managed_provider":{"name":"managed:kimi-code","status":"authenticated"}}
        ログアウト時: {"ready":false,"providers_count":0,"managed_provider":null}
```

Claude だけ 2 プロセスになるのは、`get_usage` の応答が「プランのリミットが適用されない」
までしか言わないため。正常時 (`rate_limits_available: true`) には走らないので、
定常状態のコストは増えない。

### 3 provider から実際に取れた値

2026-08-09 17:32 JST 時点。所要時間は 3 つ並列実行時の実測。

| provider | 5 時間枠 | 週枠 | リセット | 所要 |
|---|---|---|---|---|
| claude (pro) | 28% | 13% | 絶対時刻 (ISO 8601) | 947ms |
| codex (plus) | 枠なし | 13% | 絶対時刻 (Unix 秒) | 3268ms |
| kimi | 86% | 78% | 相対表現の文字列のみ | 1484ms |

## Yuru 側の構造

### インストールされているかの判定

Yuru は provider をユーザーのログインシェル経由で起動している
(`$SHELL -i -l -c 'exec claude ...'`)。つまり `claude` がどこにあるかは
ログインシェルの PATH で決まる。Electron 自身の PATH で `which` しても
答えが違う (Finder から起動した Electron の PATH は最小限で、
実際の `claude` は `~/.local/bin`、`codex` は nvm 配下、`kimi` は Homebrew 配下にある)。

なのでログインシェルに 1 回だけ聞く。3 provider をまとめて 1 プロセスで解決する。

```
$SHELL -i -l -c 'command -v claude; command -v codex; command -v kimi'
```

実測 0.46 秒。見つかった provider は絶対パスが返り、見つからない provider は
行が出ない。以降の起動はこの絶対パスを直接使う (毎回ログインシェルを挟むと
1 回 0.46 秒が provider ごとにかかる)。

この結果が **利用状況の行と、新規セッションの provider 選択肢の両方を制御する**。
「インストールされていない provider はどこにも出さない」を 1 か所で決めるため。

解決は利用状況の取得と同じ tick で毎回やり直す。ユーザーが Yuru を開いたまま
CLI を入れた場合に、再起動なしで出てくる。

ログインシェル自体の起動に失敗した場合は、その回の判定結果を捨てて
前回の一覧を保つ (起動できないのは想定外なのでエラーとして記録する)。
起動直後で前回が無ければ選択肢は空になる。ここで「全部入っていることにする」と、
入っていない provider を選べてしまい、起動して初めて失敗することになるので、
そのフォールバックは作らない。

### provider ごとの差異を閉じる場所

`SessionProviderAdapter` (provider ごとの差異を集めているインターフェース) に
1 メソッド足す。引数はログインシェルで解決した絶対パス。

```ts
loadPlanUsage(commandPath: string): Promise<ProviderPlanUsage>;
```

「plan」を名前に入れるのは、セッション内のトークン消費量と区別するため。
ここで扱うのは **プランのリミットに対する使用率** であって、セッションが
何トークン使ったかではない。

実装は provider ごとに `src/main/agents/<provider>/plan-usage.ts` に置く
(既存の `paths.ts` / `worktree-session-detection.ts` と同じ粒度)。

### 正規化した型

`src/shared/session.ts` に置く。

```ts
export interface PlanUsageWindow {
  usedPercent: number;
  // 枠がリセットされる時刻 (epoch ms)。provider が返さないときだけ null。
  resetsAt: number | null;
}

export type ProviderPlanUsage =
  | {
      provider: SessionProvider;
      state: "ok";
      // その provider がその枠を持たないときは null。Codex の 5 時間枠がこれ。
      fiveHour: PlanUsageWindow | null;
      weekly: PlanUsageWindow | null;
      fetchedAt: number;
    }
  // その CLI にログインしていない。
  | { provider: SessionProvider; state: "logged-out" }
  // ログインはしているが、プランのリミットが適用されない。
  // Claude を ANTHROPIC_API_KEY や Bedrock / Vertex で使っているとき。
  | { provider: SessionProvider; state: "no-plan-limits" }
  // 上記以外の理由で取得できなかった。error center に記録される。
  | { provider: SessionProvider; state: "failed" };
```

インストールされていない provider はこの配列に **現れない**。
「行が無い = 入っていない」「行があって値が無い = 入っているが取れない」で、
両者が混ざらないようにする。

`PlanUsageWindow` を数値だけにしないのは、「枠が無い」(null) と「枠はあって使用率 N%」を
分けて表現するため。

**リセットは相対時間ではなく絶対時刻で持つ。** 表示するのは「あと 2h9m」という
残り時間だが、それは renderer が描画のたびに `resetsAt - 現在時刻` で出す。
残り時間を state に持つと、ウィンドウのフォーカスが外れて取得が止まっている間に
表示が実際とズレる。絶対時刻なら止まっている間もカウントダウンが正しいままになる。

### Kimi のリセット時刻の作り方

Claude (ISO 8601) と Codex (Unix 秒) はそのまま absolute で返るが、
Kimi は `"resets in 2h 28m"` という **表示用の文字列でしか返さない**。
`kimi web` の `/oauth/usage` が upstream の生の時刻を捨てて整形しているため、
ローカルサーバ経由ではこれ以上の情報は取れない (サーバのルート一覧を確認済み)。

取得時刻に残り時間を足して絶対時刻に直す。この変換は
`src/main/agents/kimi/plan-usage.ts` の中だけに閉じ込め、解釈できない文字列は
`null` にする (推測で値を作らない)。

文字列の形は CLI の実装上 4 通りに限られる:

| 形 | いつ | 扱い |
|---|---|---|
| `resets in 6d 5h 28m` | 通常 (絶対時刻・相対秒どちらの upstream 応答でもこの形になる) | 取得時刻 + 残り時間 |
| `reset` | 既にリセット済み | `null` |
| `resets at <生の文字列>` | upstream の時刻を `Date.parse` できなかったとき | `null` |
| (無し) | upstream がリセット情報を返さなかったとき | `null` |

残り時間の書式は「0 でない単位だけを空白区切りで並べる」(`6d 5h 28m` / `2h 28m` /
`12m` / `30s`) と決まっている。

これは仕様ではなく実装から読み取った書式なので、正しさを実測で確認した。
1 時間 37 分あけて 2 回取得し、算出した絶対時刻が両枠とも一致している
(ズレ 8 秒。分単位に丸められているため)。

| 枠 | 17:32 の取得 | 19:09 の取得 |
|---|---|---|
| 5 時間枠 | `resets in 4h 5m` → 21:37:32 | `resets in 2h 28m` → 21:37:24 |
| 週枠 | `resets in 6d 7h 5m` → 8/16 0:37:32 | `resets in 6d 5h 28m` → 8/16 0:37:24 |

### 取得タイミング

`src/main/provider-usage-monitor.ts` に `ProviderUsageMonitor` を置く。
PullRequestMonitor と同じ作り:

- `browser-window-focus` で `start()`、`browser-window-blur` で `stop()`
- tick は 60 秒。start 時に即 1 回走る
- 前の tick が終わっていなければその回はスキップ
- 1 tick の中身は「ログインシェルで 3 provider のパスを解決 → 見つかった provider を
  並列に取得」
- 子プロセスは 10 秒でタイムアウトさせ、成否によらず必ず kill する
  (特に `kimi web` はサーバなので、放置すると生き続ける)

60 秒にする根拠: 5 時間枠は実作業で数分のうちに数 % 動く (調査中、Codex の週枠が
30 分で 6% → 13% に動いた)。一方 1 tick でログインシェル 1 つ + provider ごとに
1〜2 プロセスを起動するので、これより短くする理由は今のところない。

フォーカスが外れている間は取得しない。表示は最後に取れた値のまま残るが、
リセットまでの残り時間は絶対時刻から毎描画で計算するのでズレない。
いつ時点の値かは行の tooltip (`fetchedAt`) で分かる。

### renderer への配り方

**この配列が、利用状況の行と新規セッションの provider 選択肢の両方の source of truth**
になる。既存の `getProviders` IPC (静的に 3 provider を返していた) は、
インストールされていない provider を含んでしまうので廃止する。

- `src/shared/ipc.ts`: `onProviderPlanUsageChanged(callback: (usages: ProviderPlanUsage[]) => void)`
- チャンネル名: `providerPlanUsage:changed`
- App が state に持ち、sidebar のフッタと SessionView (新規セッションの選択肢) の両方に渡す
- 選択肢は「配列に居る provider」= インストール済み。ログイン状態では絞らない。
  未ログインの CLI を起動するとログインの導線がターミナルに出るので、
  そこから入るのは正しい使い方

初期値取得用の IPC は作らない。start は `browser-window-focus` に加えて起動時にも
1 回走らせる (フォーカスイベントが来ないことがあるため、既存の PullRequestMonitor でも
同じ手当てをしている)。最初の push が届くまでの 1〜2 秒は選択肢が空になる。

## 失敗時の挙動

取得できなかった provider は、**値を消して理由を出す**。前回値の再利用・リトライ・
0% での代替はしない。次の tick で自然に再試行される。

状態ごとの扱い:

| 状態 | 行 | 新規セッションの選択肢 | error center |
|---|---|---|---|
| インストールされていない | 出さない | 出さない | 記録しない |
| 未ログイン (`logged-out`) | 出す。値の代わりに理由 | 出す | 記録しない |
| プラン外 (`no-plan-limits`) | 出す。値の代わりに理由 | 出す | 記録しない |
| それ以外の失敗 (`failed`) | 出す。値の代わりに理由 | 出す | **記録する** |

未インストールと未ログインは「そういう状態である」だけでエラーではないので記録しない。
それ以外 (CLI が異常終了した、応答が読めない形になった、`kimi web` が起動しない、
ログインシェルが起動しない) は想定外なので、その都度 `recordAppWarning` で記録する。

同じ失敗が毎分積み重なることは受け入れる。error center は「直近の行と同じ内容なら
1 行にまとめてカウントを増やす」ので、1 つの provider が失敗し続けるぶんには 1 行のまま。
2 つ以上が同時に想定外の失敗を続けるのは稀なので、そのときに古い記録が
押し出されることは許容する。provider ごとに最後の失敗を覚えておく仕組みは作らない。

## UI デザイン

### 置き場所

sidebar のフッタ、Errors 行の上。worktree にも repo にも紐づかない
アプリ全体の情報なので、同じくアプリ全体の情報である Errors 行と並べる。

```
┌─ sidebar (既定 390px) ─────────────────┐
│ Repos                                  │
│  ▾ yuru                                │
│      F59-token-amount                  │
│      main                              │
│  ▸ another-repo                        │
│                                        │
│                                        │
├────────────────────────────────────────┤
│                  5h            7d      │
│ ● Claude    50%  2h9m    15%  5d1h     │
│ ● Codex       —      —   14%  6d18h    │
│ ● Kimi      86%  2h26m   78%  6d5h     │
├────────────────────────────────────────┤
│ ⚠ Errors                          [2]  │
└────────────────────────────────────────┘
```

値が取れなかった provider は、数値の代わりに理由を出す。
インストールされていない provider は行ごと出ない (下の例では Kimi が未ログイン、
別に Codex を入れていない場合は Codex の行そのものが消える)。

```
│                  5h            7d      │
│ ● Claude    50%  2h9m    15%  5d1h     │
│ ● Kimi      not logged in              │
```

session パネル上部の TerminalBar は選択中 worktree の情報 (branch / PR) を出す場所なので、
そこには置かない。

### 行の中身

左から: provider の色ドット / provider 名 / 5 時間枠 (使用率・残り時間) /
週枠 (使用率・残り時間)。数値は右揃え、等幅 (`--font-mono`)。
行の高さは Errors 行 (32px) より詰めて 22px。

- **残り時間は使用率と同じ大きさで、隣に必ず出す**。86% が「あと 2 時間」なのか
  「あと 10 分」なのかで意味が変わるので、tooltip に隠さない
- 見出し行 (`5h` / `7d`) を 1 行だけ置く。1 枠あたり 2 つの値が並ぶので、
  各セルに単位を書くと横に長くなりすぎる
- 色ドットは既存の `.session-provider-dot` の provider 色 (claude=橙, codex=青, kimi=灰)
  をそのまま使う。ただしセッションの active/inactive 表現は付けない。
  ここが表すのはアカウントの状態であって、セッションの状態ではない
- 枠を持たない provider (Codex の 5 時間枠) は `—`。
  これは「取得できていない」ではなく「その枠が存在しない」を表す
- 値が取れなかった行は、数値の代わりに理由を 1 つ出す。
  `logged-out` → `not logged in` / `no-plan-limits` → `no plan limits` /
  `failed` → `unavailable` (詳細は error center にある)。
  **前回取れていた値は残さない。** 古い数字が残ると、取れていないことに気づけない
- リセット時刻だけ取れなかった枠 (`resetsAt` が null) は残り時間の側だけ `—` にする
- 残り時間は上位 2 単位まで (`2h9m` / `5d1h` / `12m`)。1 分未満は `<1m`
- 80% 以上の使用率は `--warning` (#e2c08d) にする。閾値はこの 1 つだけ。
  「そろそろ切り替えを考える」ラインが一目で分かればよく、段階を増やす必要はない
- 行の tooltip にリセットの絶対時刻と取得時刻を出す
  (`5h resets 21:19 · 7d resets 8/14 19:59 · updated 19:11:11`)
- クリックできる要素にはしない。手動更新は 60 秒の定期取得で足りる

### 却下した案

- **残り時間を tooltip に入れる**: 省スペースだが、使用率だけでは判断できない
  (同じ 86% でも残り時間で意味が変わる)
- **バー表示 (使用率をゲージで出す)**: provider あたり 2 本必要で面積を食う割に、
  数値以上の情報が増えない
- **1 行に 3 provider を詰める** (`● 28/13 ● —/13 ● 86/78`): 省スペースだが、
  どの数字がどの枠かが読めない
- **TerminalBar に置く**: 横幅は余っているが、選択中 worktree の状態と
  アカウント全体の状態が同じ行に並ぶ

## スコープ外

- リセット時刻を絶対時刻で表示すること (行に出すのは残り時間、絶対時刻は tooltip)
- トークン数そのものの表示。Codex には `account/usage/read` で日別のトークン消費が、
  Claude / Kimi にはローカルログに 1 リクエストごとのトークン数があるが、
  provider をまたいで比較できる量ではないので、まずは使用率だけで様子を見る
- 履歴・グラフ
- 手動更新のボタン
