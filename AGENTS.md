# Project Guidelines

## Development

When a change affects behavior observable in the running Yuru app, rebuild and restart it from the active task worktree, not from the repository root:

```sh
npm run build
npm run app:restart
```

## E2E

Electron/Playwright e2e launches a real macOS GUI app. In Codex, do not run it in the default sandbox; use an approved/escalated `npm run test:e2e` command. Running `_electron.launch()` in `CODEX_SANDBOX=seatbelt` can abort Electron during macOS app registration and leave a system crash/reopen dialog.

E2E runs hide the BrowserWindow by default (`YURU_E2E_HIDE_WINDOW=1`). Use `YURU_E2E_SHOW_WINDOW=1 npm run test:e2e -- ...` only when visible debugging is needed.

A failing e2e test is retried once (`retries: 1`), and one that passes on the retry is reported as flaky rather than failing the run. While working on a feature, do not investigate a flaky test: report its name and move on. Chase flakes separately, by rerunning the suite with `--repeat-each` and tracking each failure down to its cause.

Real-Claude E2E borrows the user's current Claude Code login from macOS Keychain. On `Login expired` or `401 OAuth access token has been revoked`, ask the user to run `/login` in a normal Claude Code session and rerun once they confirm. Do not automate the login or change the Keychain credentials on the user's behalf. A macOS Keychain access dialog during credential seeding is a separate permission prompt, not an expired login.

## Docs

継続的にメンテされる最新情報は次の 4 つだけ:

- Purpose: `docs/purpose.md`
- Product backlog: `docs/backlog.md`
- Architecture notes: `docs/architecture.md`
- Coding guidelines: `docs/coding-guidelines.md`

それ以外の docs（ADR を含む）は書いた時点での調査・設計・検討の記録。現在の実装とズレていても更新しない。現在の設計として残すべき内容は architecture などメンテ対象のドキュメントに書く。

`docs/backlog.md` には、ユーザーの許可なく項目を追加しない。作業中に見つけた「別途やるべきこと」は、その場で報告するだけにとどめる。優先度と粒度はユーザーが決める。

## Communication

- 読み手はコードをざっくりとしか読んでいない前提で、設計やバグの説明は「つまりどういうことか」から伝える。変数名・関数名を出すときは、それが何を表すかを添える。
- 独自用語を作らず、既存のコード・ドキュメント・ユーザーの言葉に合わせる。

## Design

- 現在確認できている要件を満たす、最もシンプルな設計を選ぶ。将来の可能性のためのコードや抽象化は書かない（YAGNI）。
- 問題は根本原因から直す。ただし、無関係なリファクタリングへ変更を広げない。機能を実装しづらいときは既存設計の問題を疑い、問題があれば指摘する。
- 失敗時の挙動は重要な設計判断。フォールバック（リトライ、空値での代替、エラーの握りつぶし、防御目的の nullable 化）を勝手に追加しない。
- 状態は single source of truth を保つ。他の状態から導出できる値を state に持たない。
- ライブラリの挙動を推測して防御的なコードを書かない。ドキュメント・コード・実際の挙動で確かめる。
- 次の場合は実装前に相談する: 既存設計の大幅な変更、避けられない複雑さや汚さの導入、現実的に起こりうる失敗のハンドリング方針の決定。
