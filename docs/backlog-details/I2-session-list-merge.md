# I2 Session List Merge

Last updated: 2026-04-13

`I2` は、Claude と Codex の session 一覧を 1 つのリストに載せる今の merge 方針に無理がないかを確認するためのメモ。
表示改善の前に、session の同一性と state 判定の土台を整理しておきたい。

## Goal

- Claude と Codex の session を 1 つの一覧で扱う前提が破綻していないか確認する
- 表示上の違和感と、データモデル上の危うさを分けて考えられるようにする
- source of truth を provider ごとに持つ方針を崩さずに済むか見極める

## Current behavior

- `loadSessions()` は provider ごとの `loadStoredSessions()` を呼び、その結果を単純に連結している
- stored session と runtime session の突き合わせは `provider + providerSessionId` だけで行っている
- `project` が同じでも、provider が違えば別 session として扱う
- `repoPath` や `worktree` は merge のキーではなく、一覧表示用の補助情報として後から導出している

## Observations

- provider をまたいだ「同じ session」という概念は現状ほぼない
- 同じ repo で Claude と Codex の両方を何度も使うケースは普通にあり、`project` や `repoPath` で潰すと正しい履歴が消える
- Claude 側は `history.jsonl` の最新 entry から session を作っている
- Codex 側は `sessions/` 配下の `session_meta` と `history.jsonl` を付き合わせて session を作っている
- そのため preview 文言や timestamp の意味は provider ごとに少し違うが、session の同一性とは別問題として切り分けられる

## Main risk

- Codex は session ID の確定が遅く、起動直後の runtime session が `providerSessionId = null` を取りうる
- この間は stored session と runtime session を `provider + providerSessionId` で結び付けられない
- その結果、Codex が session を保存した直後から ID 解決完了までの短い間だけ、同じ session が
  - inactive な stored session
  - active な runtime session
  の 2 件に見える余地がある
- これは Claude/Codex の provider 間 merge が悪いというより、Codex の lazy session ID を generic merge が表現しきれていない問題

## Non-goals

- Claude と Codex の session を repo 単位で 1 件にまとめること
- provider 間で preview 文言や timestamp の意味を完全に揃えること
- Yuru 独自の session ID を永続化して provider の source of truth を置き換えること

## Possible directions

- 今の方針を維持する:
  provider 付き session ID を唯一の durable identity とみなし、cross-provider dedupe はしない
- Codex の pending session だけ補助的に寄せる:
  `providerSessionId = null` の runtime と、直後に現れた stored snapshot を provider 固有ルールで仮マージする
- 表示の正規化は別 item として扱う:
  preview の鮮度や provider ごとの差は merge 問題と分けて考える

## Conclusion

- Claude と Codex の session 一覧を 1 つの flat list に載せる方針自体には、今のところ大きな無理はない
- session の identity は引き続き `provider + providerSessionId` を軸にしてよい
- 先に手当てを検討すべきなのは、cross-provider merge の再設計ではなく、Codex の lazy session ID 中の一時的な二重表示リスク
