# Architecture v2

Last updated: 2026-04-26

この文書は、task-worktree-first モデルの target architecture をまとめる。
現行実装の説明は `docs/architecture.md` を参照する。

## Product shape

- Yuru は local agent work のための task-worktree-first な UI とする
- 主な作業単位は `repo > task worktree`
- repo は左ペインに独立した実体として表示される
- 通常の agent 作業は task worktree 上で開始し、再開もその task worktree を起点に行う
- repo root や任意 path での補助的な作業は standalone terminal として扱う

## Core entities

- `repo`
  - Yuru が主導線に表示する単位
  - `repoPath` を持つ
  - task worktree 群の親になる
  - task worktree が 0 件でも存在できる
- `task worktree`
  - Git worktree と 1 対 1 で対応する Yuru の中心単位
  - `Files`, `Changes`, branch 表示、preview の基準になる
  - repo の子として存在する
  - 現在位置は `worktreePath` で持つ
  - durable identity が必要な場合は Yuru metadata 上の `taskWorktreeId` を持つ
- `primary session`
  - task worktree に attach された provider session
  - 1 task worktree に最大 1 つだけ存在する
  - 1 provider session は同時に複数 task worktree の primary にはならない
- `suggested session`
  - provider store から推測した weak candidate
  - 明示的な attach までは primary として扱わない
- `standalone terminal`
  - task worktree に attach されない補助的な terminal
  - task-worktree model とは別レーンで扱う

## Source of truth

- Git:
  - `repoPath` が実在する Git repository かどうか
  - worktree path
  - current branch
- provider store:
  - provider session の存在
  - provider session id
  - last message や timestamp
  - provider ごとの path hint
- Yuru metadata:
  - どの repo を主導線に表示するか
  - repo と task worktree の durable identity
  - task worktree と primary session の strong link

Yuru metadata は source of truth の複製ではない。
Git や provider store が持っている状態を丸ごとコピーせず、Yuru 自身が主導線を組み立てるために必要な最小限の情報だけを持つ。
branch や provider session の本文を保存して同期し続けることはしない。

最小 schema の想定:

```json
{
  "repos": [
    {
      "id": "uuid",
      "repoPath": "/path/to/repo"
    }
  ],
  "taskWorktrees": [
    {
      "taskWorktreeId": "uuid",
      "repoId": "uuid",
      "worktreePath": "/path/to/worktree",
      "primarySession": {
        "provider": "codex",
        "providerSessionId": "..."
      }
    }
  ]
}
```

`repos` が left pane の骨格になる。
`taskWorktrees` は 0 件でもよい。
これにより、まだ worktree を 1 つも持たない repo でも Yuru 上で作業開始できる。
`primarySession` は必須ではない。
Git 上には存在するが、まだ Yuru metadata に strong link を持たない worktree もありうる。

## Repo and task worktree assembly

左ペインの repo 一覧は、まず Yuru metadata の `repos` から組み立てる。
これにより、worktree が 0 件の repo や、これから `create workspace` するだけの repo も主導線に置ける。

各 repo の配下にぶら下がる task worktree 一覧は、その repo に対して Git から worktree 群を読んで組み立てる。
repo root 自体の main worktree は含めない。
その上に provider store と Yuru metadata を重ねて primary session や suggested session を解決する。

- registered repo:
  - metadata に存在する repo
  - task worktree が 0 件でも左ペインに表示される
- empty repo:
  - registered repo だが、表示すべき task worktree がまだ 0 件の状態
  - `create workspace` の起点になれる
- strong link:
  - metadata の task worktree record が持つ `primarySession`
  - 有効ならその session を task worktree の primary として表示する
- weak candidate:
  - metadata には attach されていないが、provider store から worktree 配下と推測できる session
  - attach されるまで通常 UI の主役にはしない
- missing task worktree:
  - metadata に記録された `worktreePath` が消えている状態
  - main UI からは隠し、archive/debug 的な場所で整理できるようにする
- missing repo:
  - metadata にある `repoPath` が存在しないか、Git repository として読めない状態
  - 通常 UI では主役にせず、整理できるようにする

candidate 判定は false negative より false positive を避ける。
provider の path hint があっても、task worktree と primary session の strong link は明示操作なしに変更しない。

## Provider hints

- Claude:
  - `worktree-state` に worktree path があれば強い候補
  - session log の `cwd` が worktree 配下なら候補
- Codex:
  - `session_meta.payload.cwd` や `exec_command_end` の `cwd` が worktree 配下なら候補
  - 現在の store では `exec_command_end` は top-level type ではなく `event_msg.payload.type` として記録される
  - `turn_context.cwd` は使わない
  - `turn_context.cwd` は実行 root と混ざって紛らわしく、candidate 判定にノイズを入れやすい

provider ごとの hint は session identity を置き換えるためではなく、candidate を推測するために使う。

2026-04-26 の spike で、Claude / Codex ともに上記 hint で worktree session 検出が成立することを確認した。
詳細は `docs/backlog-details/V2-worktree-session-detection-spike.md` を参照する。

## UI structure

- 左カラムは `repo > task worktree` を基本構造にする
- repo row は task worktree が 0 件でも表示できる
- repo に task worktree が 0 件のときは、task worktree 作成のための empty state を出せる
- worktree row は branch、primary session の要約、PR 情報を持てる
- task worktree を選ぶと、右側の `Files`, `Changes`, preview, terminal がその task worktree を基準に連動する
- archived session や missing task worktree は主導線から外した補助表示に置く
- standalone terminal は task worktree list に混ぜず、別の補助機能として出す

## Operations

- add repo:
  - repo を Yuru metadata に登録する
  - Git repository として有効かは `repoPath` で検証する
- create workspace:
  - repo 配下で `git worktree add` を実行して task worktree を作る
  - その場で provider session を開始し、その task worktree の primary にする
- resume primary session:
  - Yuru の操作単位は task worktree であり、provider-specific な cwd / option は UI の裏側で吸収する
  - Claude:
    - `--worktree <name>` でどの worktree session を使うかを指定できる
    - `--worktree <name> --resume <sessionId>` なら repo root からでも該当 worktree session を resume できる
    - worktree cwd から plain `--resume <sessionId>` しても同じ worktree session を resume できる
    - repo root から plain `--resume <sessionId>` すると、worktree session を見つけられない
  - Codex:
    - worktree 専用 option を持たないため、`--cd <worktreePath>` で working root を明示する
    - worktree cwd で開始した session でも、repo root から plain `resume <sessionId>` すると root 側で作業する
    - repo root からでも `--cd <worktreePath> resume <sessionId>` すれば worktree 側で作業できる
    - Codex CLI の resume picker は cwd filtering するため、repo root から provider session 一覧を CLI 経由で見る場合は `--all` を付ける
- attach suggested session:
  - weak candidate を primary に昇格させる
  - 実体は metadata の strong link 追加
  - attach する provider session が別 task worktree の primary だった場合は、先に元の strong link を外してから新しい task worktree に attach する
  - これにより、同じ provider session が作業中に worktree A から worktree B へ移動した場合でも、B に suggested session として表示し、明示操作で primary を A から B へ移せる
- detach primary:
  - strong link を外し、再び candidate から選べるようにする
- rename task worktree:
  - `git worktree move` と metadata 更新を同時に行う
- remove task worktree:
  - `git worktree remove` を使う
  - dirty worktree 時の UX は `I1` で別途決める
- remove repo:
  - repo を Yuru metadata から外す
  - Git repository 自体は削除しない

外部 rename は自動追跡しない。
古い path の strong link は missing になり、新しい path は Git から再発見する。

## Persistence stance

- Yuru が永続化するのは repo 登録、task worktree identity、strong link、補助設定に限る
- metadata が壊れても Git と provider store から best-effort で再構成できるようにする
- 保存先の実装詳細は migration の中で別途詰める

## Non-goals

- 任意の provider session を完全に複製して復元すること
- provider 履歴から触った全 repo を自動で主導線に import すること
- 1 task worktree に複数 primary sessions を持たせること
- external rename を metadata から自動追跡すること
- `cwd` 変更を task worktree identity の source of truth にすること

## Migration Plan

この節は、V1 から V2 への移行順と checklist の source of truth とする。
`docs/backlog.md` の `V1 -> V2 Migration` セクションは、この節への導線だけを持つ。

### Notes

- ユーザーストーリーを 1 列に並べて考える
- 技術的な不安は先に spike として置く
- UX のチューニングは、まず雑に成立させたあと必要なら別 story を積む
- `Files`, `Changes`, `Diff` は migration の後半ではなく前段から影響を受ける
- まずは `Workspace` コンポーネント名を `SessionView` に寄せて、今の実体に合う名前にする
- backend の `cwd` リファクタは一旦 story として置く
- ただし、`SessionView` rename のあとに backend を見て、次の story でシュッと切り替えられると分かれば削除してよい

### Migration checklist

1. [x] Claude の worktree session 検出が成立するかを spike で確認する
2. [x] Codex の worktree session 検出が成立するかを spike で確認する
3. [ ] ダミーの metadata で repository 一覧を表示できる
   - metadata に `repos` のダミーデータを置ける
   - worktree が 0 件でも、その repo は左ペインに表示される
   - 既存の session-first 左ペインはまだ見えていてよい
4. [ ] `yuru add` で repository を Yuru 上で見ることができる
   - user は repository 内で `yuru add` を実行できる
   - Yuru は `cwd` から repo root を見つけて metadata に登録できる
   - まだ task worktree がない repo でも、ここから作業開始の起点にできる
   - すでに登録済みなら重複登録しない
5. [ ] `Workspace` コンポーネントを `SessionView` に rename できる
6. [ ] backend で Files / Changes / Diff が参照する作業ルートを、`cwd` 直結ではない中立な概念として扱える
   - ここではまだ `worktreePath` に切り替えない
   - 実体は引き続き `cwd` のままにして、参照の形だけをリファクタリングする
   - ただし、このリファクタが次の story に吸収できると分かれば削除してよい
7. [ ] repository から新規 worktree セッションを開始できる
   - ここで初めて `worktreePath` ベースに切り替える
   - 既存の session-first 左ペインはここで UI から隠す
   - ただし実装は削除せず、後で使い回せるように残す
8. [ ] primary session のアイテムに active / inactive が表示できる
9. [ ] primary な worktree から既存セッションを再開できる
10. [ ] primary session のアイテムに provider が表示できる
11. [ ] primary session のアイテムに preview 文字列が表示できる
12. [ ] Claude の suggested worktree session を表示できる
13. [ ] サジェストされた worktree session を primary に昇格できる
14. [ ] Codex の suggested worktree session を表示し、primary に昇格できる
15. [ ] primary session のアイテムに branch 名が表示されている
16. [ ] V1 の session-first 実装を削除できる

### Open points

- `6` の中立な概念名を何にするか
- `6` を独立 story として残すか、`7` に吸収するか
- `7` の時点で UI 上の worktree item に最低限どこまで表示するか
- `active / inactive` を最終 UX に残すか、開発用の確認表示としてあとで外すか
