# I4 Persistence

Last updated: 2026-04-11

`I4` は、Yuru が持つべき状態を永続化するための実装メモ。
開発時と本番時の保存先分離は `I5` として別に扱う。

## Goal

- 現時点では Yuru 独自の保存データはほぼないが、今後は設定や補助状態を持つ可能性が高い
- どのデータを Yuru 自身が持つかを整理しないと、将来の保存先設計がぶれやすい
- source of truth を provider や git に寄せる方針と矛盾しないようにしたい

## Target behavior

- セッション一覧は `~/.claude` と `~/.codex` を source of truth として読んでいる
- Yuru 側で同じ情報を二重管理しない方針がある
- Yuru 独自の状態は、source of truth の複製ではなく設定や補助状態に限る
- Electron の `userData` は別途存在するが、Yuru 独自データを何でもそこに置く前提にはしたくない

## Initial scope

- グローバル設定
- プロジェクト設定
- UI の補助状態

## Implementation questions

- Yuru が永続化してよいのはどの種類の状態か
- グローバル設定、プロジェクト設定、UI 状態をどう分けるか
- `Application Support` に残してよいものと、Yuru 側で明示的に持ちたいものの境界はどこか
