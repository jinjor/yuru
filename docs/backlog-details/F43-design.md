# F43 設計記録: worktree 選択と session 操作の分離

Last updated: 2026-07-16

[F43 詳細](F43-worktree-session-responsibilities.md) の責任分担を前提に、spike の結果と具体的な interaction の決定を記録する。

## Spike 結果

`.yuru/worktrees` にある worktree で Claude session が Yuru の想定どおり成立することを、
実機 e2e (本物の claude CLI、isolated HOME) で確認した。

- session が紐づいていない `.yuru/worktrees` の worktree で、新規 Claude session を開始できた
- Claude のファイル操作 (Write) は main worktree ではなく対象 worktree に向いた
- app restart 後に primary session が inactive として検出され、resume で会話が復元された
- metadata の primary を失った状態でも、provider store の証跡 (tool_use の file_path) から
  suggested session として検出された

Yuru 側の session 検出・resume は worktree の絶対パスにだけ依存し、`.claude/worktrees` という
配置には依存していないことがコード上でも確認できた。統一を妨げる問題はない。

## 決定事項

### worktree の作成と配置

- repo の `+` で入力するのは branch 名だけ。provider は選ばない
- 新規 task worktree は provider によらず `<repo>/.yuru/worktrees/<worktreeName>` に作る
  (worktreeName は branch 名の `/` を `-` に置換)
- 既存の `.claude/worktrees` / `.yuru/worktrees` の worktree は移行しない。
  worktree の発見は `git worktree list` によるパス非依存の走査であり、移行には
  ディレクトリ移動と provider store の cwd 証跡とのズレというリスクしかないため
- 作成に成功したら session を開始せずにその worktree を選択し、右ペインの Terminal に
  session の選択肢を表示する。作成の失敗はモーダル内に表示する (従来どおり)

### 左ペイン (card) は worktree 選択に徹する

- card クリックは常に worktree の選択。primary の有無で役割を変えない
- primary session が active runtime を持つ場合は、その terminal を添えて選択する
  (すでに動いているものを隠す理由がない)
- それ以外 (primary なし / inactive primary) は terminal なしで選択する。
  **card クリックでプロセスは起動しない**
- main worktree の card は従来どおり standalone terminal を開く (F32 で扱う領域には触れない)
- card に残る操作は選択と `︙ → Remove worktree` (worktree lifecycle) だけ。
  card 上の session 開始 popover (action surface) は廃止し、Terminal 側へ移す
- card の表示 (branch、PR badge、provider dot、preview、existing session 件数) は現状維持

### Terminal が session lifecycle を担う

選択中 worktree に表示すべき terminal runtime がない時、Terminal パネルの本文に
session start surface を表示する。ヘッダ (Terminal / branch / PR badge) は共通。

- primary session がない worktree:
  - `Existing Session`: suggested sessions の一覧 (preview / provider / timestamp)。
    クリックで promote + resume (従来の card popover と同じ挙動)
  - `New Session`: Claude / Codex ボタン。クリックで新規 session を開始し primary に attach
- inactive primary がある worktree:
  - primary の provider と preview を表示し、`Resume` ボタンで復元する
  - 別 provider での開始や既存 session の昇格は出さない (現状の card にもない。F44 の
    紐付け解除を入れてから意味を持つ)

inactive primary の復元は**明示操作**とする。worktree 選択が「見るだけ」の操作
(Files / Changes の確認) を兼ねる以上、選択に伴ってエージェントプロセスが起動するのは
F43 の分離原則に反するため。復元は Terminal 内の 1 クリックに収める。

session の開始・復元に失敗しても worktree と選択状態はそのまま残す。
エラーは error center に記録し、Terminal は session start surface のまま。

### 選択状態の表現

- UI の選択状態は `{ worktreeId, terminalRuntimeId | null }` に変える
  (従来は両方必須で、session がないと worktree を選択できなかった)
- `terminalRuntimeId` が null の間は Terminal に session start surface を表示し、
  Files / Changes / preview / file search は worktreeId 基準でそのまま使える
- terminal runtime の exit 時は worktree の選択を保ち、`terminalRuntimeId` だけ null に戻す
  (従来は選択全体が解除されて placeholder に落ちていた)

### Backend

- 新 IPC `createTaskWorktree(repoPath, branchName)`: 検証 (既存ディレクトリ / 既存 branch)、
  `git worktree add`、metadata への upsert だけを行い `{ worktreeId }` を返す。
  provider の起動もその失敗による巻き戻しもない
- `createWorktreeSession` (worktree 作成 + session 開始の一体フロー) は削除。
  新規作成後の session 開始は、既存 worktree と同じ `createSessionForWorktree` を使う
- `SessionProviderAdapter` から worktree lifecycle (`resolveWorktreePath` /
  `prepareWorktree` / `finalizeWorktree`) を除去する。worktree の作成と配置は
  Yuru (service) の責任になり、adapter は session の起動・検出・resume に専念する
