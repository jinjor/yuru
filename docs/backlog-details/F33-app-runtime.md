# F33 App Runtime

Last updated: 2026-04-11

`F33` は、起動元ごとに `start/stop/restart` を安全に扱えるようにするための実装メモ。
対象はランタイム制御だけで、保存先の話は含めない。

## Goal

- 複数の Yuru を同時に立ち上げたとき、ある起動元からの `restart` が別の起動を巻き込むと困る
- 比較用に複数の worktree で同時起動したいケースはありうる
- 人間と AI のどちらが使っても、対象の選ばれ方が直感的である必要がある

## Target behavior

- `start` は現在の起動元に対応する Yuru だけを起動する
- `stop` は現在の起動元に対応する Yuru だけを止める
- `restart` は現在の起動元に対応する Yuru だけを止めて起動し直す
- 起動元の違う Yuru プロセスは相互に巻き込まない

## Non-goals

- Yuru 独自データの保存先
- Electron の `userData` の置き場所
- 開発時と本番時の保存先分離

これらは architecture v2 の persistence 方針として別に扱う。

## Implementation questions

- 対象識別は repo root 単位か、worktree path 単位か、明示的な instance token を持つか
- `start` は未起動時のみ起動にするか、既に起動中なら前面化するか
- `stop` と `restart` の対象を、CLI からどこまで明示できるようにするか
