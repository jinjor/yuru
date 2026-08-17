# F60/F61/F66 並び替えの構造設計

Last updated: 2026-08-17

## Goal

- F61: リポジトリを並び替えられるようにする
- F66: task worktree を並び替えられるようにする
- F60: primary session を並び替えられるようにする

3 つの並び替えの体験に一貫性を持たせる。並び替え結果はアプリを閉じても保持する。
新規 worktree はこれまで通り一番下に追加される。並び替え対象の session は primary のみ。

インタラクション設計 (D&D の振る舞い、タブでの並び替え、画面外ドラッグ対策) は
[F60-F61-F66-ui-design.md](F60-F61-F66-ui-design.md) を参照。この doc は
データモデル・永続化・IPC の構造だけを扱う。

## 現状の整理

表示順の根拠は 3 者でバラバラ:

- **repo**: `metadata.repos` の配列順 (= `yuru add` の登録順)
- **task worktree**: metadata には順序を持たず、Git 管理ディレクトリの `createdAt` 昇順
  (`src/main/git/worktree.ts`)。`TaskWorktreeMetadata` は primary session との
  strong link 保持専用で、Git 上にあるが metadata に無い worktree も一覧に出る
- **primary session**: `TaskWorktreeMetadata.primarySessions` の配列順 (= attach 順)

## 設計方針: 「metadata の配列順 = 表示順」に統一する

3 つすべてを「metadata が持つ配列の順がそのまま表示順」に揃え、
並び替え = その配列の並べ替えとして永続化する。新規要素は配列の末尾に現れる、
というルールも 3 者で一致する。

### repo

`metadata.repos` を直接並べ替える。既に表示順 = 配列順なので、
reorder は配列の書き換えだけでよい。`yuru add` が末尾に push する現状とも矛盾しない。

### primary session

`primarySessions` を直接並べ替える。これも表示順 = 配列順。
attach / promote が末尾に push する現状 = 「新規 session は一番下」。

タブの並びは `TerminalTabs.tsx` が保存された primary session 順に active なものを
並べる構造なので、metadata 側を並べ替えればタブ順も自動的に追随する。
タブ用に別の順序を持たない (single source of truth)。

### task worktree

`TaskWorktreeMetadata` の配列順を流用することはできない。
Git にあるが metadata に entry の無い worktree が存在しうるためで、
全 worktree の entry を materialize すると Git が持つ状態の複製を metadata に
作ることになり、architecture.md の「metadata は source of truth の複製ではない」
方針に反する。

そこで `RepoMetadata` に順序だけを持つ:

```ts
export interface RepoMetadata {
  id: string;
  repoPath: string;
  // task worktree の表示順。ユーザーが並び替えた時にだけ書かれる。
  // 実在しない path は読み出し時に捨て、記載の無い worktree は末尾に追加する。
  worktreeOrder?: string[]; // worktreePath の配列
}
```

表示順の組み立て (repo-list.ts):

1. `worktreeOrder` にあるものを、その順で (実在するものだけ)
2. `worktreeOrder` に無い worktree を、従来通り `createdAt` 昇順で末尾に

この構造の性質:

- **新規 worktree は一番下**。`worktreeOrder` に無いので末尾に来る。
  Yuru 経由でも `git worktree add` 直接でも同じ
- **並び替えは presentation state**。Git の状態の複製ではなく「ユーザーが決めた並び」
  なので、metadata に持つのは方針と矛盾しない
- **stale entry は読み出し時に自然に捨てられる**。worktree 削除後に path が
  残っていても実在しないので無視される (掃除は不要)

### main worktree の扱い (要確認)

RepoList は `[mainWorktree, ...taskWorktrees]` の順で描画している。
`worktreeOrder` は task worktree だけを対象とし、**main worktree は常に先頭固定**
(並び替え対象外) とするのが最もシンプル。main worktree の UX 自体は I22 の
検討対象なので、ここで並び替え可能にする必然性はないと考えるが、判断を仰ぐ。

## IPC

既存の `<domain>:<verb>` パターンに乗せた 3 つの invoke を追加する:

- `repos:reorder(repoIds: string[])`
- `worktrees:reorder(repoId: string, worktreePaths: string[])`
- `worktreeSession:reorderPrimary(worktreeId: string, agentSessionKeys: string[])`

いずれも renderer は「並び替え後の全要素の ID 配列」を送る。
service 側の検証は同じ形:

- 送られた ID セットが現在の対象セットと一致しなければ、書き込まずに
  `Result` の error を返す (stale な一覧からのドラッグで他の変更を
  巻き込んで上書きするのを防ぐ)。部分適用や黙った補正はしない
- worktree の reorder では、送信された path セットが「現在実在する task worktree
  全体」と一致することを要求し、`worktreeOrder` にはその全順序を書く

成功後は既存の push パターンに乗る: service が `repoListChanged` を発火し、
`repos:changed` を受けた renderer が一覧を取り直す。楽観的更新をするかは
UI 設計側の判断で、構造上は不要 (metadata 書き込みは同期で軽い)。

## スキーマ変更と互換性

- `RepoMetadata.worktreeOrder` は optional な追加フィールドなのでマイグレーション不要
- `scripts/yuru-cli` は metadata を spread で保持しながら読み書きするので
  未知フィールドで壊れないはず。実装時に CLI 経由の読み書きで
  `worktreeOrder` が消えないことをテストで確認する

## 失敗時の挙動

- ID セット不一致: 書き込まず error。renderer は一覧を取り直して最新状態に戻す
- 書き込み自体の失敗: 既存と同じく error center に記録して `Result` error を返す。
  リトライや空値での代替は設けない

## テスト

- metadata / repo-list レベル: 並び替えの往復、`worktreeOrder` に無い worktree が
  末尾に来ること、削除済み path が無視されること、セット不一致が拒否されること
- 既存の `test/main` のパターンに従う

## 関連する今後の機能: F67 ファイルの D&D

main に F67「ファイル名を右ペインからターミナルにドロップできるようにする」が
追加された (2026-08-17 時点で backlog のみ、未実装)。Yuru 内に D&D が
もう 1 つ登場する見込みなので、並び替えの D&D と操作感・実装方式
(HTML5 D&D かポインタベースか) が揃うように UI 設計側で考慮する。
ドロップ先がターミナル (テキストとしてパスを渡す) である F67 は
HTML5 D&D (`dataTransfer`) が自然で、並び替えがポインタベース
(`runPointerDrag` 系) になると 2 方式が同居する。どちらに寄せるか、
または割り切って併存させるかは UI 設計の判断事項。

## architecture.md の更新 (実装時)

- 「task worktree は Git の管理ディレクトリの作成日時が古い順に表示する」
  → ユーザー指定順 + 未指定は作成日時順、に書き換え
- 「primary session は attach 順を保持する」→ ユーザー指定順を保持する、に書き換え
- タブ順の記述 (「保存された primary session の順」) は構造上変わらないが、
  「保存された順」の意味が attach 順からユーザー指定順に変わる点を明確にする
