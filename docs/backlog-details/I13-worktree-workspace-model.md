# I13 Worktree Workspace Model

Last updated: 2026-04-24

`I13` は、Yuru を worktree-first に寄せるかどうかを設計として確定し、
architecture / backlog / 旧方針を整理するための item である。

この文書は実装仕様の確定版ではない。
ここで直接このまま実装に入るのではなく、まず以下を行うための整理メモとして使う。

- worktree-first モデルの全体設計を固める
- 新しい全体設計を `docs/architecture-v2.md` として書く
- backlog の再編
- 実装アイテムへの分解

各実装アイテムに分解したあと、必要ならその item ごとに Design Doc を別途作る。
現行の `docs/architecture.md` は、実装が追いつくまでは現状説明として残す。

## Background

実務で worktree を使う運用を続けた結果、以下が分かってきた。

- セッションごとに worktree を必ず切る運用でも、体感上の不便はほとんどない。
- 当初は、`node_modules` など gitignore された依存物の管理が重くなることを懸念していた。
- 実際には agent が必要な準備を自然に解決することが多く、worktree を切るコストは想定より低かった。
- 左側に provider session をフラットに並べるより、`repo > worktree` の構造が見えている方が現在地を把握しやすい。
- root で軽い作業をする運用は、便利さよりも「この session はどこを見ているのか」という混乱を生みやすい。

今の Yuru は柔軟さのために、`session`, `worktree`, `branch`, `cwd` を疎な関係のまま扱っている。
しかし、その柔軟さが内部構造と UI の複雑さを増やしている。
通常作業は毎回 worktree を切る、という前提を置くことで、Yuru のモデルを単純にできる可能性が高い。

## Scope of this item

`I13` 自体のスコープは実装ではない。

- worktree-first を前提に、Yuru の中心モデルをどう置き換えるかを決める
- `docs/architecture-v2.md` に書く全体設計をまとめる
- 既存 backlog / architecture をどう整理するかを決める
- 実装可能な単位に分解する

逆に、この item の段階でやらないこと:

- UI の全面実装
- metadata 永続化の本実装
- attach / rename / standalone terminal など個別機能の実装
- provider ごとの細かい復元ロジックの作り込み
- `docs/architecture-v2.md` 自体の作成

## Product stance

- Yuru の主な作業単位は `worktree workspace` とする。
- 通常の agent 作業は、repo root ではなく worktree 上で行う。
- workspace に属さない操作は、session として管理するより standalone terminal として扱う。
- UI は provider session のフラット一覧ではなく、`repo > worktree` を基本構造にする。
- repo に属さない provider session や、worktree に紐付けられない session は主導線から外してよい。

## Core model

- `repo`
  - Git repository の root。
  - worktree 一覧の親になる。
- `worktree workspace`
  - Yuru の中心的な作業単位。
  - `Files`, `Changes`, branch 表示などの基準になる。
  - identity は Yuru metadata の `workspaceId` で持つ。
  - 現在の場所は `worktreePath` で持つ。
- `branch`
  - worktree の現在状態として Git から読む。
  - Yuru metadata の source of truth にはしない。
- `primary session`
  - worktree に attach された provider session。
  - 1 worktree に最大 1 つだけ存在する。
- `cwd`
  - provider session の推測材料にはなりうる。
  - Yuru の表示基準の source of truth にはしない。

## Metadata policy

Yuru metadata は source of truth ではなく hint として扱う。

- Git が worktree と branch の source of truth。
- Provider store が provider session の source of truth。
- Yuru metadata は「この worktree では、この provider session を primary として扱う」という強い関連付けだけを保存する。
- 外部情報を Yuru metadata に import して同期し続けることはしない。
- metadata が壊れても、Git と provider store から best-effort で画面を再構成できるようにする。

最小 schema の候補:

```json
{
  "workspaces": [
    {
      "id": "uuid",
      "worktreePath": "/path/to/worktree",
      "primarySession": {
        "provider": "codex",
        "providerSessionId": "..."
      }
    }
  ]
}
```

`branch` は保存しない。
必要なら表示補助として last known 情報を持つ余地はあるが、最初は増やさない。

## Strong links and weak candidates

Yuru metadata にある `worktreePath -> primarySession` は strong link とする。

- strong link が有効なら、その worktree の primary session として表示する。
- primary session がある worktree では、他の session candidate は通常 UI に表示しない。
- strong link の `worktreePath` が存在しなければ、その workspace は missing とする。
- missing workspace は通常 UI から隠し、archive/debug 的な場所で削除可能にする。

metadata がない worktree でも、provider store から session 候補を推測できる場合がある。
これは weak candidate として扱う。

- Claude:
  - `worktree-state` に worktree path があれば高 confidence。
  - session log の `cwd` が worktree 配下なら candidate。
  - `--name`, `slug`, `summary` は表示補助として使える。
- Codex:
  - `session_meta.cwd` や `exec_command_end.cwd` が worktree 配下なら candidate。
  - `turn_context.cwd` は provider の実行 root と混ざるため、強い根拠としては扱わない。

`Attach suggested session` を実行すると、weak candidate は primary session に昇格する。
昇格しなかった candidate は provider store から消すのではなく、Yuru の通常 UI から隠すだけにする。
primary を detach できる内部操作があれば、再び candidate から選べるようになる。

## Worktree naming and rename

worktree directory name は外部エディタや terminal にも見える。
完全ランダムな名前にして Yuru 内で隠す設計は、VSCode など他ツールとの併用でつらくなる。

- worktree 名は人間が読める名前にする。
- 初期値は branch 名や user prompt から作る。
- Yuru 内で worktree rename を行った場合は、`git worktree move` と metadata 更新を同時に行う。
- branch rename と worktree rename を連動させるかは別途検討する。
- 外部で worktree が rename された場合、自動追跡はしない。
- 外部 rename 後は、古い strong link は missing になり、新しい path は Git 由来の worktree として再発見される。
- その worktree に provider session 候補があれば weak candidate として attach できる。

## Standalone terminal

workspace に属さない terminal は残す。
ただし、それを provider session として主導線に混ぜない。

- git 操作、rebase、確認作業などは standalone terminal で行えるようにする。
- standalone terminal の起点は repo root でも任意 path でもよい。
- standalone terminal は `repo > worktree` の session model とは別の補助機能として扱う。
- standalone terminal の履歴や永続性は、worktree workspace の primary session とは切り離して考える。

## Non-goals

- 任意の provider session をすべて Yuru 上で完全復元すること。
- 外部で rename された worktree を metadata から自動追跡すること。
- 1 worktree に複数 primary sessions を持たせること。
- `cwd` 変更を Yuru の表示基準として追い続けること。

## Open questions

- metadata file の保存場所をどこにするか。
- missing workspace の UI をどこに置くか。
- `Attach suggested session` の confidence 表示をどの程度出すか。
- worktree rename と branch rename をどこまで一体化するか。
- standalone terminal を repo ごとに 1 つにするか、単発 terminal として扱うか。
- Yuru 外で作った worktree に primary session がない場合、新規 provider session をどう開始するか。
