# B17: Electron 43 のオンデマンドダウンロードに `app:restart` を対応させる

## Problem

クリーンな `npm ci` の直後に `npm run app:restart` を実行すると、次のエラーで起動できない。

```text
Electron app bundle not found: /Users/jinjor/projects/yuru/node_modules/electron/dist/Electron.app
```

一度 `npx install-electron --no` を実行すれば起動できるが、開発者がこの手順を知っていることを前提にしたくない。

## Cause

Electron 42 以降、npm package の install script では Electron binary をダウンロードしなくなった。Electron 43 では、`electron` の main bin を初めて実行したときに必要な binary をダウンロードする。

現在の `scripts/restart-app-macos.sh` は `electron/package.json` の場所から `dist/Electron.app` を組み立て、その存在を確認してから `open` で直接起動する。この経路では Electron の main bin が一度も実行されないため、binary のオンデマンドダウンロードが始まらない。

`strict-allow-scripts=true` や `allowScripts` の設定が原因ではない。Electron 43 の npm package には対象となる install lifecycle script 自体がない。

## Desired behavior

- `npm ci` 後、Electron binary がまだ存在しない状態でも `npm run app:restart` だけで Yuru を起動できる。
- Binary の取得には Electron が提供するオンデマンドインストール経路を使う。
- 既に正しいバージョンの binary がある場合は再ダウンロードしない。
- ダウンロードに失敗した場合は起動成功として扱わず、失敗理由がコマンド利用者に分かる形で終了する。
- Electron の install script を `allowScripts` に追加しない。

## Verification

1. `node_modules/electron` は存在するが `dist` と `path.txt` がない状態を用意する。
2. `npm run app:restart` を実行する。
3. Electron 43 の binary が取得され、Yuru が起動することを確認する。
4. 続けて `npm run app:restart` を実行し、既存の binary を使って再起動することを確認する。
5. `npm run package:local` の Electron 取得・パッケージング経路に影響がないことを確認する。

## Temporary workaround

```sh
npx install-electron --no
npm run app:restart
```
