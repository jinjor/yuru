# B9 再ビルドで起動中の画面の動的 import が失敗する

Last updated: 2026-07-15

## Problem

Yuru を起動したまま `npm run build` すると、その後ファイルを選んだ時に
`Failed to fetch dynamically imported module` で画面全体がエラー表示になることがある。

起動中の画面は、起動時に読み込んだ entry chunk に記録されたハッシュ付きファイル名を参照する。
一方、Vite build は `dist/renderer` を空にしてから新しいハッシュの chunk を出力する。
このため、Markdown preview や editor などを初めて開くのが再ビルド後だと、すでに消えた旧 chunk を要求して失敗する。
ファイル選択処理同士の race ではなく、起動中の画面と build 成果物の世代ずれである。

## Impact and priority

- 主に開発中の build と app restart の間で発生する
- packaged app でも、起動中に app bundle を置き換える場合は同じ条件になりうる
- エラー画面の Reload は renderer だけを読み直す。main process と PTY は継続する
- 作業中の agent は止まらず Reload で復旧できるため、優先度は低い

## Direction

- 起動中の renderer が参照しうる旧ハッシュの chunk を、build 中は残す
- 古い chunk の掃除は、旧 renderer を停止した app restart 中や package 作成時に行う
- 動的 import 自体は維持する

## Acceptance

- 旧 build の画面を起動したまま新しく build しても、未表示だった Markdown preview / editor を開ける
- app restart 時に不要な旧 chunk を安全に掃除できる
- package に不要な旧 chunk が混ざらない
