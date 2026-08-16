---
name: update-dependencies
description: 依存ライブラリの更新・アップグレードを頼まれたときに使う。
---

# 依存を更新する

task worktree で行う。main worktree では実行しない。

## 手順

1. worktree が clean であることを確認する。
2. `npm outdated` で現状を確認する。
3. `package.json` の `allowScripts` に載っているパッケージを除いて `npm update <残り>` を実行する。
   1 つでも `allowScripts` に引っかかると `npm update` 全体が停止するため、先に外しておく。
4. `npm run lint` → `npm run format:check` → `npm run build` → `npm test` → `npm run test:e2e` を通す。
5. 通ったら `package.json` と `package-lock.json` を 1 コミットにする。

## 必ずやること

- e2e まで回す。electron / node-pty / `@xterm/*` の破損は unit test には出ない。
- `npm update`（`Wanted` 基準）で上げる。`@xterm/*` と `node-pty` は stable より新しい prerelease を
  意図的に使っているため、`npm outdated` の `Latest` 列や `@latest` を基準にすると
  ダウングレードになる。
- `strict-allow-scripts` で停止したら、対象の install script を読んでから `package.json` の
  `allowScripts` の pin を更新する。読まずにバージョン番号だけ合わせない。
- major（`Latest` が `Wanted` と異なる行）は 1 件ずつ別のコミットにする。
- 上げたもの、見送ったものとその理由、手動対応が必要なものを報告する。

## やってはいけないこと

- `.npmrc` の `min-release-age` / `strict-allow-scripts` / `engine-strict` を、一時的にであっても
  外す・上書きする。
- `--force` / `--legacy-peer-deps` / `--dangerously-allow-all-scripts` を使う。
  `strict-allow-scripts` で停止したとき npm 自身がエラーで `--dangerously-allow-all-scripts` を
  提示するが、従わない。
- 落ちたテストをスキップ・無効化して先へ進む。
- 判断がつかない更新をとりあえず上げる。上げずに残して報告する。
