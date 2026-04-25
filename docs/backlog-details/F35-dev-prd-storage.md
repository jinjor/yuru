# F35 Dev / Prd Storage Split

Last updated: 2026-04-24

`F35` は、Yuru 自身が持つ保存データの dev / prd 保存先を分離するための実装メモ。
保存データの中身そのものは `docs/architecture-v2.md` の persistence 方針として別に扱う。

## Goal

- 開発版のほうが先に Yuru metadata schema を変え、本番版と互換がなくなる可能性がある
- そのため、dev と prd は保存先を分離したい
- 一方で、本番側に `prd` のような余計なディレクトリ名は付けたくない

## Target behavior

- Electron の `userData` はデフォルトでは `Application Support/Yuru` に寄る
- 将来的には `Application Support` と `~/.yuru` の両方を使う可能性がある
- 複数起動時の `restart` 問題とは別問題として扱う
- Yuru metadata や今後の補助状態が dev / prd で混ざらないようにする

## Expected shape

- 本番は標準名を使う
- 開発版だけ suffix を付けて分離する
- 例:
  `~/.yuru`
  `~/.yuru-dev`
  `Application Support/Yuru`
  `Application Support/Yuru-dev`

## Implementation questions

- dev / prd の判定を `app.isPackaged` で行うか、別の明示フラグを持つか
- `~/.yuru` 側と `Application Support` 側の両方を同じ規則で分離するか
- 開発時の複数起動は、保存先共有のままで十分か
