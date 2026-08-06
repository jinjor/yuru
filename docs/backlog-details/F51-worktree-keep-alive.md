# F51 詳細設計: worktree ごとに開いていたファイルを覚えておく (keep-alive)

Last updated: 2026-08-04

これは決定版の詳細設計。議論の経緯と個別課題の決着は
F51-keep-alive-open-issues.md に記録がある。

## 何が問題か

worktree を切り替えて戻ると、開いていたファイル (preview)、選択中のタブ、
Files ツリーの展開、検索語が消えている。
原因は、右ペイン (SessionView) が `key={worktreeId}` で worktree ごとに作り直されるため、
切り替えの unmount で配下の local state が全て破棄されること。
Files / Search はタブ切り替えでも unmount されるため、同一 worktree 内でも
タブを離れると展開・検索語が消える。これも同じ問題として一緒に直す。

## 設計の要約

- worktree を切り替えても SessionView を unmount せず、instance を生かしたまま
  React の `<Activity mode="hidden">` で非表示にする。表示状態は各コンポーネントの
  local state が持ち主のまま動かさない。外部の保管庫・新しい state は作らない
- 描画する instance の集合は既存 state からの導出:
  **「各 repo の main worktree (常時) ∪ primary session が active な worktree ∪ 選択中」**
- ExplorerPanel のタブ (Changes / Files / Search) にも同じパターンを適用する
- データの鮮度は「復帰時の effect 再実行」で回復する。「復元」という特別な処理は
  存在しないため、失敗時挙動は常にライブ操作と同一で、新しいフォールバックを作らない
- 再描画コストは「repos 更新の参照保存 + `memo(SessionView)`」で抑える。
  根絶は P22 (worktreeId 単位の取得・購読) で行い、本 F51 では踏み込まない

## 設計

### Activity の意味論 (前提知識)

`<Activity mode="hidden">` は子の state と DOM を保持したまま effect だけを
unmount し (cleanup が走る)、visible に戻ると effect を再実行する。
hidden な子への更新は低優先度で適用される。React 19.2 で追加され、
この repo の installed React 19.2.7 が `Activity` を export していることは確認済み。

つまり hidden 中は「切り替えで離脱した」のと同じ状態 (polling 停止・watcher 解除・
リスナー解除・xterm dispose) になり、state と DOM だけが残る。

### 描画する instance の集合

App が repos と selectedWorktreeId から毎 render 導出する。専用の state は持たない。

- 各 repo の main worktree: **常時**。standalone terminal (provider なしの素のシェル) は
  repos データの active 判定に載らない (`service.ts` の `getTerminalRuntimesByWorktreePath`
  が provider なしの runtime を除外している) ため、導出では拾えない。
  「standalone でバックログを表示しながら他の worktree に作業させる」ユースケースが
  必須のため、例外として常時描画する
- `primarySession?.state === "active"` な task worktree (= active な terminal runtime を持つ)
- 選択中の worktree (session がなくても Files / Changes / preview を使えるという
  現行仕様を後退させないため)

このライフサイクル規則が複数の問題を同時に解決する:

- **exit の聞き逃しが構造的に起こらない**: hidden 中に session が exit すると、
  App が exit 通知で repos を取り直し、その worktree は集合から抜けて instance ごと
  unmount される。死んだ runtime を指す state は残らない。復帰時の生存確認は不要
- **メモリが有界**: instance 数 = main worktree 数 + 同時 active session 数 + 選択中 1。
  eviction は作らない
- **掃除が自動**: worktree の削除 (Yuru 内・外部とも) は repos 一覧から消えることに
  収斂し、描画対象から外れて React が破棄する。同名で作り直しても前世の状態を
  引き継がない
- session のない task worktree は選択中しか保持されない (選択解除で忘れる)。
  これは今と同じ挙動で、F51 の適用範囲の線引きとして受け入れる

補足 (race): 「session 開始操作の完了前に別 worktree へ切り替える」と、その worktree は
まだ active でないため unmount され、runtime 起動完了後に active として hidden で
mount し直される。これは唯一の「hidden での初 mount」だが、terminalRuntimeId の
useState initializer が worktree prop から activeTerminalRuntimeId を拾うので正しく動く。

### P20 との整合

P20 の「切り替え = unmount による古い非同期結果の構造的無効化」は、右ペインが
共有 1 枠であることが前提の課題だった。本設計では:

- instance は worktree ごとに keyed なので、古い結果は自分の instance にしか届かない
- active でない worktree (= session 開始・detach などの操作中でまだ runtime がない
  worktree) は今まで通り切り替えで unmount されるので、P20 が守っていた
  「進行中の操作の結果が引き戻さない」はそのまま成立する
- 「App の選択状態は selectedWorktreeId だけ」「runtime と session 操作は SessionView が
  持つ」という P20 の分担は変えない

### 隠れている間に何が起こるか (状態の分類)

| 同期手段 | 該当する state | hidden 中 | 対応 |
|---|---|---|---|
| ユーザー操作でのみ変わる | previewSelection, explorerTab, expandedDirectories, 検索語, isCommittedExpanded, pane 分割幅, FileSearch の開閉 | 変わりようがない | なし (そのまま残るのが本機能) |
| effect で取得・polling | gitPathStates, reviewState, diff 内容, treeData, 検索結果 | 更新が止まり古くなる | 復帰時の effect 再実行で取得し直す |
| イベント購読で同期 | terminalRuntimeId | 聞き逃すが、exit したら instance ごと消えるので残らない | なし |

新しい state を追加する時はこの分類を意識する。イベント購読で同期する state を
足す場合は「hidden 中に聞き逃して大丈夫か」の説明が必要 (architecture.md に規律として
残す。Step 5)。effect は「復帰で再実行されても壊れない」ように書く (React の contract)。

### 再描画コストの抑制

hidden instance に PTY の出力ストリームは届かない (renderer に届くのは
session preview / activity の小さな push だけ)。問題は App の repos 更新が
全 instance の再描画を誘発すること。2 段の原因があり、両方直す:

1. `applySessionUpdate` (App.tsx) が push のたびに全 repo・全 worktree オブジェクトを
   作り直しており、props の参照が毎回変わる。隣の `applyPullRequestUpdates` と同じ
   参照保存スタイル (変わらない項目は同じオブジェクトを返し、何も変わらなければ
   prev そのものを返す) に直す
2. SessionView に `memo` がない。参照保存とセットで `memo(SessionView)` を入れる。
   コールバック props (onOpenExternal / onSessionsChanged) は既に useCallback 済み

sidebar ドラッグ中は sidebarWidth prop が変わるため memo は効かないが、
一時的なバーストで hidden 側は低優先度なので許容する。
恒久的な根絶 (worktreeId 単位の取得・購読でブロードキャスト自体を消す) は P22。

## 実装ステップ

各ステップは独立して main に入れられる順で並べてある。
Step 1・2 は挙動を変えない準備で、単体でも価値がある。

### Step 0: スパイク (使い捨てブランチ、merge しない)

App の SessionView 描画を雑に Activity で包んだブランチを作り、以下を実機確認する。
結果は F51-keep-alive-spike-results.md に課題番号との対応が分かる形で記録する。

- [x] Activity の基本挙動: hidden で effect の cleanup が走る / state と DOM が残る /
      復帰で effect が再実行される
- [x] SessionView は fragment で複数のトップレベル要素 (`.session-view-column`、
      resize handle、ExplorerPanel の `<aside>`) を返す。Activity hidden が
      その全てを非表示にし、`.app` の flex レイアウトが崩れないこと。
      崩れる場合は SessionView を単一のコンテナ要素で包む CSS 調整を先に行う
- [ ] xterm: hidden で `term.dispose()` (TerminalPanel の cleanup) が走り、復帰で
      再生成 + main (headless xterm) からの復元が今の remount と同じに動くこと。
      IME 入力 (日本語変換) を含めて確認。xterm / Chromium composition は検証済みで、
      macOS native IME の手動確認だけが残る
- [x] DiffPreviewPanel の lazy + Suspense (EditModeEditor / HtmlPreview /
      MarkdownPreview) が hidden / 復帰で壊れないこと
- [x] scroll 位置が保持されるかを一応観察する (保持は期待値にしない。結果の記録のみ)
- [x] 再描画コストの絶対値計測: active session 4〜5 本 + それぞれ大きい diff を
      開いた状態で、streaming 中の CPU と React Profiler の commit を記録する。
      Step 1 の対策あり / なしの両方で測ると効果が数字で残る

### Step 1: repos 更新の参照保存と memo 化

挙動を変えない準備。単一 instance の現状でも無駄な再描画が減る。

- [x] `applySessionUpdate` / `applyPullRequestUpdates` / `samePullRequest` /
      `findWorktree` を App.tsx から新モジュール `src/renderer/utils/repoList.ts` へ移す
      (App.tsx は xterm の css を import しているため `node --test` から読めない。
      移動はテストのための必須作業)
- [x] `applySessionUpdate` を参照保存スタイルに書き直す: 対象 runtime を含む worktree
      だけ新オブジェクトにし、他の worktree / repo は同じ参照を返す。
      どこにも該当がなければ prev そのものを返す
- [x] unit test `test/renderer/utils/repoList.test.mjs` を追加:
      「該当しない worktree / repo は変更前と `===` で同一」
      「該当なしなら prev そのものが返る」を applySessionUpdate と
      applyPullRequestUpdates の両方に対して固定する
- [x] `SessionView` を `memo` で包む
- [x] 確認: `npm test` が通ること
- [x] 確認: `test/e2e/session-view-memo.test.ts` が通ること
- [x] 確認: 既存 e2e が全件通ること

### Step 2: FilesPane の「初期化」と「接続」の分離

挙動を変えないリファクタリング。現在の mount effect は「state を空にリセットして
ROOT を load」しており、effect が再実行される環境では保持していた state を自分で消す。
このリセットは、pane が生きたまま worktreeId が入れ替わっていた旧構造
(2026-04-19, c39443c7) の名残で、key で作り直される現構造では冗長。

- [x] connection effect から `setExpandedDirectories(new Set())`、
      `commitFilesCache(createEmptyFilesCache())`、load 管理のリセットを削除する。
      state と ref の初期化はそれぞれの `useState` / `useRef` だけが担う
- [x] connection effect 本体を「`expandedDirectoriesRef.current` を読み、
      ROOT + 展開中ディレクトリを親から順に `loadDirectory(path, force = true)` で
      直列に再読込」にする。順序は `revealChangedDirectories` と同じ理由で必須
      (親より先に子を load すると `applyDirectoryListing` が反映先を見つけられない)。
      ROOT の追加と並べ替えには既存の `buildWatchTargets` を使う
- [x] 展開セットは effect の依存に入れない (展開のたびに全再読込が走ってしまう)。
      ref 経由で「effect 実行時点の展開状態」を読む
- [x] 消えていたディレクトリの掃除は、親の最新一覧を適用する既存の
      `applyDirectoryListing` / `removeDirectorySubtrees` に任せる。
      追加の存在チェックは書かない
- [x] load の無効化機構は変更しない (hidden 時は既存の cleanup effect が
      `directoryLoadsRef` を空にするので、古い load 結果は復帰後に適用されない)
- [x] 確認: 現構造 (毎回 fresh mount) では従来と同じ挙動になること。
      既存の explorer-panels e2e が通ること

### Step 3: SessionView の keep-alive 化 (本体)

- [ ] `src/renderer/utils/repoList.ts` に導出関数
      `collectKeepAliveWorktrees(repos, selectedWorktreeId): WorktreeListItem[]` を追加:
      main worktree (常時) + `primarySession?.state === "active"` + 選択中。
      worktreeId で重複排除 (選択中が main や active と重なるため。key 重複は
      React が壊れるので必須)。並び順は repos の並びに従い安定させる。
      unit test を追加 (重複排除・選択中の包含・active の包含)
- [ ] App.tsx: `key={selectedWorktreeId}` の単一 SessionView 描画を、導出リストの
      Activity 列挙に置き換える:

      ```tsx
      import { Activity } from "react";
      ...
      {collectKeepAliveWorktrees(repos, selectedWorktreeId).map((worktree) => (
        <Activity
          key={worktree.worktreeId}
          mode={worktree.worktreeId === selectedWorktreeId ? "visible" : "hidden"}
        >
          <SessionView worktreeId={worktree.worktreeId} worktree={worktree} ... />
        </Activity>
      ))}
      ```

      選択なしの場合の `SessionPlaceholder` は従来通り (hidden instance とは共存する)
- [ ] SessionView に描画カウンタを仕込む: render 中に
      `window.__yuruSessionViewRenderCounts[worktreeId]` をインクリメントする
      (計測専用の意図的な render 副作用であることをコメントで明示。
      hidden 中は effect が動かないため、effect でのカウントでは代替できない)
- [ ] SessionView / App 内の「切り替えで unmount されるので古い結果が戻らない」系の
      コメントを新しい前提 (active でない worktree は従来通り unmount、active は
      hidden 保持) に書き直す
- [ ] 既存 e2e の全セレクタ監査: hidden instance の DOM が残るため、SessionView 配下を
      触る locator が複数マッチして Playwright の strict mode で落ちる。
      `test/e2e/helpers.ts` に「表示中の SessionView にスコープした locator を返す」
      ヘルパーを追加し、既存テストをそれ経由に直す。全 e2e が通るまでがこのタスク
- [ ] 新規 e2e `test/e2e/session-view-keep-alive.test.ts`:
      - 保持: worktree A でファイルを開き Files タブでディレクトリを展開 → B へ切り替え
        (A は session を active にしておく) → A に戻ると preview・タブ・展開が残っている
      - 破棄: A の session を hidden 中に exit させる → A に戻ると session start surface
        が出る (死んだ runtime を指さない)
      - 掃除: worktree を削除して同名で作り直す → 前の表示状態を引き継がない
      - 追従: hidden 中に agent がファイルを変更 → 復帰後 polling 1 周期 (3 秒) 以内に
        Changes / diff が追いつく
- [ ] 新規 e2e (再描画の不変条件): worktree B で session を動かして push を流しながら
      A を表示。B の preview / activity の変化 (push が届いた証拠) を待つ間、
      無関係な A と main worktree のカウンタが増えないことを assert する。
      session の起動は session-activity.test.ts と同じ仕組みを流用する。
      hidden の描画は低優先度なので、カウンタの読み取りは expect.poll 等で待つ
- [ ] 確認: `npm run build && npm run app:restart` で手動確認 + 全テスト

### Step 4: ExplorerPanel タブの keep-alive 化

Step 2 が前提。worktree 切り替えとは独立に入れられる。

- [ ] ExplorerPanel の条件描画 (`activeTab === ... ? <ChangesPane/> : ...`) を、
      3 つの pane をそれぞれ `<Activity mode={...}>` で包む形に置き換える
- [ ] hidden pane の後始末 (watcher 解除・実行中検索のキャンセル) は既存の
      effect cleanup がそのまま担うことを確認する。追加実装はしない
- [ ] e2e: 同一 worktree 内で Files → Changes → Files と往復して展開が残ること、
      Search の検索語と結果が復帰することを keep-alive の e2e に追加
- [ ] 確認: 手動 + 全テスト

### Step 5: ドキュメントとコメントの追従

- [ ] architecture.md の UI structure 節を更新:
      「右ペインは worktree ごとに作り直す (P20)」→「main / active / selected の
      instance を保持し、Activity の hidden で非表示にする。active でない worktree は
      従来通り切り替えで破棄される」。復帰時の effect 再実行の意味論と、
      「イベント購読で同期する state を足す時は hidden 中の聞き逃しを考慮する」
      「effect は復帰での再実行に耐えるように書く」の規律を 1〜2 行で残す
- [ ] backlog.md の F51 を完了として外す (P22 は残す)
- [ ] 確認: ドキュメントのみの変更なので rebuild 不要

## スコープ外

- app 再起動をまたぐ永続化 (state は renderer のメモリにあり、terminal runtime と
  同じライフサイクルで消える)
- scroll 位置の保持 (display:none 中の保持はブラウザ依存。残ればおまけ)
- pane 分割幅の全 worktree 共通化 (keep-alive により worktree ごとに保持される。
  「切り替えでリセット」よりは良く、共通化したければ別件)
- session のない task worktree の状態保持 (選択解除で忘れる。今と同じ)
- 再描画コストの根絶 (P22: worktreeId 単位の取得・購読)

## 検討して採らなかった案 (要点のみ。経緯は open-issues と会話ログ)

- **ユーザー操作で決まる状態だけ外部の保管庫へ退避し remount 時に復元する (A 案)**:
  動くが、保管庫・中央スキーマ・二重書き込みの規約・削除の帳簿という概念が増える。
  keep-alive は同じ結果を「状態を動かさない」ことで得る
- **CSS 非表示 (`display: none`) だけで隠す**: effect が生き続け、polling・watcher・
  window リスナー・xterm が instance 数分併走する。手動で hidden prop を配って
  止める案は、全 leaf が可視性という横断的関心を知ることになる
- **バックエンドで持つ**: 読者が renderer しかいない表示状態のために IPC を増やす
  理由がない
