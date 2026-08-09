# F59 調査: 各プロバイダの利用状況をどこから取れるか

Last updated: 2026-08-09

「3 provider すべてで、常に、トークンを消費せずにプランの利用状況を出せるか」を調べた記録。
決定版の設計は F59-provider-usage.md にある。

調査対象のバージョン: claude 2.1.226 / codex (@openai/codex, `app-server` protocol v2) /
kimi-code 0.29.2。どれも実装が動くうちに確認した内容で、更新はしない。

## 結論

- 3 provider とも、**既にその CLI にログインしていれば追加の準備なしで**、
  公式の使用率をトークン消費なしで取れる
- ただし取り口は 3 つとも別物で、どれも experimental か非公開寄り
- ローカルのログから取れるのは Codex の使用率だけ。Claude と Kimi は
  ログにトークン数しか残らない

## 最初に確認したこと: ローカルのファイルだけで足りるか

足りない。

| provider | ファイルに残っているもの |
|---|---|
| claude | `~/.claude/projects/<project>/<sessionId>.jsonl` に 1 メッセージごとのトークン数。使用率は **どこにも保存されていない** |
| codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` の `token_count` イベントに、provider が返した `rate_limits` がそのまま同梱されている |
| kimi | `sessions/<workdir>/<session>/agents/<agent>/wire.jsonl` の `usage.record` にトークン数のみ。使用率なし |

Claude については `~/.claude` 配下と `~/.claude.json` を検索した。CLI 内部には
取得結果を `cachedUsageUtilization` として設定ファイルに保存する経路があるが、
実機には書かれていなかった (書き込みに TTL の条件があるため)。当てにできない。

ローカルのトークン数を自前で合計する案も検討したが、使用率には変換できない。
リミットの計算式 (モデル別の重み付け) が非公開で、窓の起点も分からず、
claude.ai / ChatGPT / kimi.com など他クライアントでの消費が見えないため。

## provider ごとの取り口

### claude

CLI バイナリ内に見つかった経路は 3 つ。

1. **statusLine**: 標準入力の JSON に `rate_limits.five_hour` / `seven_day` が入る。
   ただし「そのセッションが最初の API 応答を受けた後」だけで、
   ユーザーの statusLine 設定と 1 枠を取り合う
2. **SDK の control request `get_usage`**: 内部で `GET /api/oauth/usage` を叩くので、
   セッションが動いていなくても最新値が返る。"Experimental — the response shape may change" と明記
3. **`GET /api/oauth/usage` を Yuru から直接叩く**: 非公開 API で、
   Keychain のトークンを Yuru 自身が扱うことになる

2 を採用した。1 は「実行中のセッションがある間だけ」という制約が要件に合わず、
3 は認証を Yuru が抱え込む。

`claude -p "/usage"` (素の CLI 引数) も試した。`/usage` は CLI 内部で
`type: "local"` / `supportsNonInteractive: true` として登録されていて、
モデルには行かない (実測で `total_cost_usd: 0` / `num_turns: 0`)。
ただし返るのは表示用テキストで、実行のたびに空の transcript が 1 個残るため採らなかった。

### codex

`codex app-server` の JSON-RPC に `account/rateLimits/read` がある。
`codex app-server generate-json-schema --out <dir> --experimental` でスキーマを出すと、
`GetAccountRateLimitsResponse` と `GetAccountTokenUsageResponse` (日別トークン消費) が確認できる。

rollout ファイルを読む案もあるが、そちらは「最後に Codex が API 応答を受けた時点の
スナップショット」で、他クライアントの消費や窓のリセットが反映されない。
app-server 経由なら常に最新なので、こちらを採用した。

### kimi

`kimi web` が立てるローカルサーバの `GET /api/v1/oauth/usage`。
その先は `https://api.kimi.com/coding/v1/usages` を OAuth トークンで叩いている。

Yuru から upstream を直接叩く案もあるが、`~/.kimi-code/credentials` の
トークンを Yuru が扱うことになるので採らない。

## Codex の 5 時間枠は今は返ってこない

ローカルの rollout に残っている `window_minutes` を数えると、5 時間枠 (300 分) は
2026-07-12 を最後に一度も現れない。以降は週枠 (10080 分) のみで、`secondary` は常に `null`。

| 期間 | 300 分の枠 | 10080 分の枠 |
|---|---|---|
| 〜2026-07-12 | あり | あり |
| 2026-07-13 〜 | 無し | あり |

app-server 経由でも同じだった (`secondary: null`)。plan は `plus`。

## トークンを消費しないことの確認

| provider | 確認方法 | 結果 |
|---|---|---|
| claude | 応答内の `session.total_cost_usd` と `model_usage` | `0` / `{}` |
| codex | スレッドを作らないので API 呼び出し自体が発生しない | rollout ファイルが増えない |
| kimi | REST の 1 回だけでモデルには触れない | — |

## セッションの記録を残さないことの確認

いずれも実行前後で以下が無変化だった。

- claude: transcript ファイル / `history.jsonl` / `~/.claude/sessions/<pid>.json`
- codex: rollout ファイル / `session_index.jsonl` / `history.jsonl`
- kimi: `session_index.jsonl`

なお `claude -p "/usage"` の形だけは transcript ファイルを 1 個作る
(`history.jsonl` には書かれないので Yuru の一覧には出ないが、ファイルは残る)。

## 実際に取れた値

2026-08-09 17:32:32 JST、3 つ並列実行。

```
claude (947ms)  five_hour 28% / seven_day 13%  (subscription_type: pro)
codex  (3268ms) primary 13% (windowDurationMins 10080) / secondary null  (planType: plus)
kimi   (1484ms) 5h limit 86/100 / Weekly limit 78/100
```

## インストールされているかの判定

Yuru は provider をユーザーのログインシェル経由で起動している
(`$SHELL -i -l -c 'exec claude ...'`) ため、Electron 自身の PATH で探しても答えが違う。
実機では 3 つとも別の場所にあった。

```
/Users/jinjor/.local/bin/claude
/Users/jinjor/.nvm/versions/node/v25.4.0/bin/codex
/opt/homebrew/bin/kimi
```

ログインシェル 1 プロセスで 3 つまとめて解決できる。実測 0.46 秒。

```
$SHELL -i -l -c 'command -v claude; command -v codex; command -v kimi'
```

## ログインしていない状態の見分け方

3 provider とも、構造的に (文字列マッチではなく) 見分けられる。
ログアウト状態は環境変数でホームディレクトリを空に向けて再現した。

| provider | 再現方法 | ログアウト時の応答 |
|---|---|---|
| claude | `HOME` を空ディレクトリに | `get_usage` は成功し `{"rate_limits_available":false,"rate_limits":null,"subscription_type":null}`。`claude auth status --json` は `{"loggedIn":false,"authMethod":"none"}` |
| codex | `CODEX_HOME` を空ディレクトリに | `account/read` が `{"account":null}` (ログイン時は `{"account":{"type":"chatgpt","email":"...","planType":"plus"}}`) |
| kimi | `KIMI_CODE_HOME` を空ディレクトリに | `GET /api/v1/auth` が `{"ready":false,"providers_count":0,"managed_provider":null}` (ログイン時は `managed_provider.status: "authenticated"`) |

Claude の `rate_limits_available: false` は「未ログイン」と「API キー等でプラン外」の
両方を含む。区別するには `claude auth status --json` がもう 1 プロセス必要
(実測 0.2 秒)。Codex と Kimi はどちらも同じ接続・同じサーバで聞けるので追加コストなし。

参考までに、Codex でログアウトしたまま `account/rateLimits/read` を投げると
`{"code":-32600,"message":"codex account authentication required to read rate limits"}` が返る。
メッセージ文字列に依存したくないので、判定には `account/read` を使う。

## リセット時刻

3 provider とも取れる。ただし形が違う。

| provider | 返り方 |
|---|---|
| claude | `resets_at` に ISO 8601。5 時間枠・週枠の両方 |
| codex | `resetsAt` に Unix 秒。ただし枠自体が週のみ |
| kimi | `reset_hint` に `"resets in 2h 28m"` という表示用の文字列のみ。絶対時刻は返らない |

Kimi のローカルサーバは upstream の生の時刻を捨てて整形している
(`toWireUsage` → `resetHintFrom`)。サーバのルート一覧を確認したが、
生の値を返す口は他に無い。

そこで「取得時刻 + 残り時間」で絶対時刻に直せるかを実測で確認した。
1 時間 37 分あけて 2 回取得し、算出結果が両枠とも一致した (ズレ 8 秒)。

| 枠 | 17:32 の取得 | 19:09 の取得 |
|---|---|---|
| 5 時間枠 | `resets in 4h 5m` → 21:37:32 | `resets in 2h 28m` → 21:37:24 |
| 週枠 | `resets in 6d 7h 5m` → 8/16 0:37:32 | `resets in 6d 5h 28m` → 8/16 0:37:24 |

3 provider を揃えて取ったところ (2026-08-09 19:11 JST):

```
claude   5時間枠 50%  8/9 21:19 (あと 2h9m)    週枠 15%  8/14 19:59
codex    5時間枠 枠なし                        週枠 14%  8/16 12:57
kimi     5時間枠 86%  8/9 21:37 (あと 2h26m)   週枠 78%  8/16 00:37
```

なお Codex の週枠のリセット時刻は取得のたびに動く (8/14 08:57 → 8/16 12:57)。
固定の曜日境界ではなく、消費が古くなるにつれてずれる窓と思われる。
