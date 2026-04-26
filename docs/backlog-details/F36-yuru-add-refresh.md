# F36 Yuru Add Refresh

Last updated: 2026-04-26

`F36` は、外部 terminal で実行した `yuru add` の結果を、起動中の Yuru の repo 一覧に反映するための実装メモ。

## Goal

- `yuru add` 後に、ユーザーが登録結果を Yuru 上で確認できる

## Target behavior

- `yuru add` で登録した repo が、起動中の Yuru の repo 一覧に反映される

## Non-goals

- `yuru add` そのものの repo 登録処理
- repo metadata schema の拡張

## Implementation Options

例えば次のような方法が考えうる。

- main から renderer へ metadata 更新を push する
- 手動 refresh 操作を置く
- `yuru add` 後に再起動を促す
