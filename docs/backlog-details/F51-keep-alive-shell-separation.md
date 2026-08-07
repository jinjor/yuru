# F51 修正設計: keep-alive の単位を worktree スコープと runtime スコープに分離する

2026-08-06、I21 (primary session 見直し) の設計セッションからの差し込み。
この文書は F51-keep-alive-open-issues.md / F51-worktree-keep-alive.md の後続修正であり、
実装時はこの文書の内容を正とする。完了後に F51-worktree-keep-alive.md へ反映する
(手順の最後に含める)。

## 何を直すのか

F51 の現行実装は keep-alive の単位が SessionView で、描画集合の導出が
「session が active な worktree」に連動している
(`src/renderer/utils/repoList.ts` の `collectKeepAliveWorktrees` が
`worktree.primarySession?.state === "active"` を条件に含む)。
しかし SessionView が持つ状態の大半 (preview 選択、ExplorerPanel のタブ、
Files の展開、検索語) は **worktree に紐づく情報で、session の状態に依存しない**。

このカップリングにより、現状では以下が起こる。すべて修正対象の誤った挙動である。

1. hidden 中に session が exit すると、worktree が描画集合から外れて
   instance ごと unmount され、Files の展開・preview・検索語が消える。
   (現行 e2e `test/e2e/session-view-keep-alive.test.ts` はこの誤った挙動を
   固定してしまっている)
2. session のない task worktree は選択解除で即 unmount され、
   切り替えて戻ると Files の展開等が消える (F51 設計メモが
   「線引きとして受け入れる」と書いていた挙動。受け入れを撤回する)。

## 設計

### 2 つのスコープ

- **worktree スコープ (shell)**: 現 SessionView 全体。keep-alive の単位はこちら。
  session の有無・生死に関わらず、「一度訪れた worktree」は app 起動中は生き続ける。
- **runtime スコープ (terminal)**: TerminalPanel。表示中 runtime と一緒に生き、
  runtime が死んだら start surface に戻る。F51 の現行構造でも概ねそうなっているが、
  「hidden 中の exit を検知する手段」が instance の消滅に依存していたのを、
  props からの導出に置き換える (後述)。

コンポーネント名・ファイル名は変えない (SessionView のまま)。rename は churn が
大きいだけなのでやらない。役割の変化はコメントと architecture.md で伝える。

### keep-alive 集合の新しい導出

描画集合 = **各 repo の main worktree (常時) ∪ 訪問済み ∪ 選択中**。

- 「訪問済み」は App が持つ `visitedWorktreeIds: ReadonlySet<string>` の state。
  worktree を選択した時にだけ追加する。削除は導出側で repos に存在する id だけを
  拾うため自動的に効く (worktree 削除 → repos から消える → 描画対象外 → React が破棄)。
  set 内に残った stale id は描画に影響しないので掃除しない (YAGNI)。
- 「session が active」という条件は **削除する**。session が動いているだけで
  一度も表示されていない worktree に UI 状態は存在せず、keep-alive する意味がない。
  terminal runtime 本体 (headless xterm) は main process が持っているので、
  instance を mount しなくても何も失われない。

これにより F51 設計メモにあった race の注意書き
(「session 開始操作の完了前に別 worktree へ切り替えると hidden で初 mount される」)
は発生しなくなる。開始操作はその worktree を選択中に行うので、
その時点で訪問済みになり instance は生き続ける。

### 表示中 runtime の生存判定

shell が hidden 中に runtime の exit イベントを聞き逃しても、
戻った時に死んだ runtime を指し続けないようにする。

1. `WorktreeListItem` に `activeTerminalRuntimeIds: string[]` を追加する。
   main が repo list 組み立て時に、その worktree を cwd とする **全ての** live
   terminal runtime の id を載せる。provider なし (standalone terminal) も含める。
   - 現状 `service.ts` の `getTerminalRuntimesByWorktreePath` は
     `if (!info.provider) continue;` で standalone を除外し、かつ 1 worktree 1 件の
     Map である。**この既存メソッドは変更しない** (card の fallback 合成が使っている)。
     別メソッドで `Map<string /* worktreePath */, string[]>` を新規に作って渡す。
2. SessionView は render 時に導出する:

   ```ts
   const activeIds = worktree?.activeTerminalRuntimeIds ?? [];
   const displayedTerminalRuntimeId =
     terminalRuntimeId && activeIds.includes(terminalRuntimeId) ? terminalRuntimeId : null;
   ```

   JSX では `terminalRuntimeId` ではなく `displayedTerminalRuntimeId` を使う
   (TerminalPanel の描画条件と prop)。
3. 既存の `onTerminalRuntimeExited` 購読での `setTerminalRuntimeId(null)` も残す
   (表示中に exit した場合の即時反映)。導出は hidden 中の聞き逃しのカバー。
4. **開始直後の flicker 対策**: session 開始直後は repos へ反映されるまで
   `activeIds` に新しい runtime id が載らず、導出が null を返してしまう。
   `startTerminalRuntime` 内で `setTerminalRuntimeId(...)` の後の
   `onSessionsChanged()` を `void` ではなく `await` し、repos が新しい runtime を
   含んでからガード (`isStartingRef`) を外す。detach 側が既にそうしている
   (コメント参照) のと同じパターン。

なお、この導出により main worktree の standalone terminal が hidden 中に exit した時に
死んだ runtime を指し続ける既存の穴 (F51 では main は常時描画なので instance 消滅に
頼れない) も副産物として直る。

### TerminalPanel の runtime スコープ化

`<TerminalPanel>` に `key={displayedTerminalRuntimeId}` を付け、
runtime ごとに別 instance になることを明示する (xterm の状態が別 runtime に
持ち越されないことを構造で保証する)。

## 実装手順

1. `src/shared/metadata.ts`: `WorktreeListItem` に
   `activeTerminalRuntimeIds: string[]` を追加 (必須フィールド)。
2. `src/main/service.ts`: 全 runtime (provider なし含む) の
   `Map<worktreePath, string[]>` を作る private メソッドを追加し、
   repo list 組み立て (`getRepoList`) で渡す。
3. `src/main/repo-list.ts`: 組み立て関数がその Map を受け取り、
   各 `WorktreeListItem.activeTerminalRuntimeIds` に載せる。
   (worktreePath の照合は既存の `toWorktreePathKey` の扱いに揃える)
4. `src/renderer/App.tsx`:
   - `visitedWorktreeIds` state を追加。
   - worktree を選択する全経路 (`onSelectWorktree`、worktree 作成成功時の
     `setSelectedWorktreeId`) を `selectWorktree(worktreeId)` ヘルパーに集約し、
     選択と visited 追加を同時に行う。`setSelectedWorktreeId(null)` する箇所
     (削除時・refresh 時のガード) では visited を触らない。
   - `collectKeepAliveWorktrees` の呼び出しに `visitedWorktreeIds` を渡す。
5. `src/renderer/utils/repoList.ts`:
   `collectKeepAliveWorktrees(repos, selectedWorktreeId, visitedWorktreeIds)` に
   変更し、条件を「main worktree ∪ visited ∪ 選択中」にする。
   `primarySession?.state === "active"` の条件は削除。
6. `src/renderer/components/SessionView.tsx`:
   - `displayedTerminalRuntimeId` の導出を追加し、JSX の TerminalPanel 描画に使う。
   - TerminalPanel に `key` を付ける。
   - `startTerminalRuntime` で `await onSessionsChanged()` する。
   - 「active でない task worktree は従来どおり選択解除時に unmount される」等の
     コメントを新しい前提 (訪問済みは session の有無に関わらず保持) に書き直す。
7. 型追加に伴うコンパイルエラー (テスト fixture 等) を全て直す。

## テストの更新

- `test/renderer/utils/repoList.test.mjs`:
  `collectKeepAliveWorktrees` の「active の包含」テストを
  「visited の包含」(訪問済みなら session がなくても含む、未訪問なら active でも
  含まない) に置き換える。重複排除・選択中の包含は維持。
- `test/e2e/session-view-keep-alive.test.ts`:
  - 「active session が hidden 中に終了 → instance ごと破棄」を固定している部分を
    書き換える。新しい期待値: 戻ると start surface が出る (terminal は消える) が、
    **Files の展開・開いていた preview は残っている**。
  - 「session のない worktree から切り替えて戻ると状態が残る」ケースを追加する。
  - worktree 削除 → 同名再作成で状態を引き継がないケースはそのまま通るはず
    (repos から外れるので instance は破棄される)。通ることを確認する。
- `test/e2e/session-view-memo.test.ts`: 変更不要なはず (render count の不変条件は
  影響を受けない)。通ることを確認する。

## ドキュメントの更新 (実装後)

- `F51-worktree-keep-alive.md`: 以下の節をこの修正設計に合わせて書き直す。
  - 「設計の要約」の描画集合の定義
  - 「描画する instance の集合」節 (active 条件の撤廃と訪問済みの導入、
    exit 時の挙動、standalone の穴が直ったこと)
  - 「隠れている間に何が起こるか」の表の terminalRuntimeId 行
    (props からの導出で回復する旨)
  - 「スコープ外」の「session のない task worktree の状態保持」(訪問済みは保持する
    ようになったので記述を更新)
  - 「検討して採らなかった案」はそのまま残す
- `architecture.md`: Step 5 で予定している UI structure 節の更新を、この修正後の
  構造 (shell = 訪問済み worktree 単位で保持、terminal runtime は props 導出) で書く。
- `docs/backlog-details/I21-primary-session-experience.md` は I21 側で管理するので
  このタスクでは触らない。

## やらないこと

- コンポーネント / ファイルのリネーム (SessionView の名前は据え置き)
- I21 のタブ UI や複数 primary session (別タスク)
- app 再起動をまたぐ永続化 (引き続きスコープ外)
- 表示状態のバックエンド移動 (F51 の却下案。覆さない)
- `getTerminalRuntimesByWorktreePath` 既存メソッドの挙動変更

## 受け入れ条件

- hidden 中に session が exit しても、その worktree に戻ると Files の展開・
  preview・検索語が残っている (terminal は start surface に戻る)。
- session のない worktree から別 worktree へ切り替えて戻っても同様に残る。
- worktree を削除して同名で作り直すと状態を引き継がない。
- `npm test` と全 e2e が通る。
