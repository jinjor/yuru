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

- 現在の要件を満たす、最もシンプルな設計を選ぶ（YAGNI）。
- 原因を持つ責務の範囲で問題を直す。既存設計が妨げになる場合は、その設計も見直す。
- 失敗時の挙動はプロダクトの仕様として扱う。外部依存の契約と実際に起こる失敗条件を根拠に設計する。
- 状態は single source of truth を保ち、導出できる値は計算する。
- 既存設計を大きく変える場合や、失敗時のユーザー向け挙動が未決定の場合は、根拠・影響・選択肢を示して実装前に相談する。通常の実装判断は既存の仕様と設計に沿って進める。
