# F51 B 案 (keep-alive + Activity) の残課題リスト

Last updated: 2026-08-04

B 案 (keep-alive) 検討時の議論記録。決定版の詳細設計は F51-worktree-keep-alive.md に
まとめてあり、以後の更新はそちらだけ行う。Step 0 の検証結果は
F51-keep-alive-spike-results.md に記録している。

| # | 課題 | 状態 |
|---|---|---|
| 1 | FilesPane の mount effect の書き換え | 方針決定 |
| 2 | terminalRuntimeId の復帰時生存確認 | 解決 (専用対応不要) |
| 3 | App の構造変更 (描画集合の導出 + Activity 列挙) | 方針決定 |
| 4 | タブ切替の扱い | 方針決定 (同パターン適用) |
| 5 | 初 mount のタイミング前提 | 決定 (main worktree だけ例外) |
| 6 | Activity の実挙動の検証 | 検証済み |
| 7 | xterm / IME の検証 | xterm / composition は検証済み、macOS native IME は手動確認待ち |
| 8 | lazy + Suspense との組み合わせの検証 | 検証済み |
| 9 | scroll 位置の扱い | 決定・観測済み (期待値に入れない) |
| 10 | イベント購読で同期する state の規律 | 縮小して合意 |
| 11 | effect の「復帰で再実行される」前提の規律 | 合意 (B 特有ではない) |
| 12 | E2E セレクタが hidden DOM に当たる問題 | 未議論 |
| 13 | hidden instance の再描画コスト | 対策方針決定・計測済み (根絶は P22) |
| 14 | メモリ | 解決 |
| 15 | P20 前提のコメント・architecture.md の追従 | 未着手 |

## 決まったことの要約

- 描画する instance の集合は導出で決め、新しい state を持たない:
  **「各 repo の main worktree (常時) ∪ primarySession が active な worktree ∪ 選択中」**
- main worktree を常時描画するのは、standalone terminal でバックログ等を表示しながら
  他の worktree に作業させるユースケースが必須のため
- session のない task worktree は保持対象外 (切り替えで忘れる。今と同じ挙動)
- 「active でなくなったら instance ごと破棄」というライフサイクル規則が、
  exit 聞き逃し (課題 2) とメモリ有界化 (課題 14) を同時に解決する

## 実装しないと成立しない変更

### 1. FilesPane の mount effect の書き換え — 方針決定

- 復帰 (hidden → visible) で必要なのはデータの再読込だけで、state のリセットは不要
- 今のリセットは過去の構造の名残。2026-04-19 の "Replace FilesPane tree implementation"
  (c39443c7) 時点では pane が生きたまま worktreeId が入れ替わる構造で、この effect が
  切り替えハンドラだった。SessionView が key で作り直される現構造にその経路はない
- 直し方: 「state の初期化」は instance 生成 (useState) に任せ、effect は「(再) 接続と
  データ取得」だけにする。state を触らず、ROOT + 展開中ディレクトリを親から順に
  force 再読込する (`revealChangedDirectories` と同じ手順。親より先に子を load すると
  `replaceNodeChildren` が反映先を見つけられない)。hidden 中に消えたディレクトリは
  既存の `normalizeExpandedDirectories` が刈る
- worktree ごとの state の分離は Activity の key (別 instance) が保証するので、
  FilesPane 側で worktree の区別を考える必要はない
- これは B のデメリットではなく、混在した責務 (初期化と接続) を分ける構造修正。
  A 案でも必要な変更

### 2. terminalRuntimeId の復帰時生存確認 — 解決 (専用対応不要)

- 描画集合を「active な session を持つ worktree」の導出にしたことで、hidden 中に
  session が exit すると repos 再取得 (App は exit 通知で取り直す) で集合から抜け、
  instance ごと unmount される。死んだ runtime を指す state は構造的に残らない
- 表示中の exit は、購読 effect が生きているので今まで通り null に戻る
- 残るのは「exit から repos 再取得完了までの間に選択する」細い窓だが、これは今日も
  存在する repos の鮮度ラグと同質で、B 案が新設するものではない
- main worktree の standalone terminal が hidden 中に exit した場合は、復帰時に
  既存の auto-open effect が再実行されて reuse / 開き直しするので、こちらも対応不要
- 生存確認の IPC は作らない

### 3. App の構造変更 — 方針決定

- 訪問済みリストのような新しい state は持たない。描画集合は既存 state
  (repos + selectedWorktreeId) からの導出:
  main worktree (常時) ∪ `primarySession?.state === "active"` な worktree ∪ 選択中
- active の判定に standalone terminal (provider なし) は載らない
  (`service.ts` の `getTerminalRuntimesByWorktreePath` が provider なしの runtime を
  除外している) ため、main worktree は「常時描画」という形でカバーする
- repos 一覧から消えた worktree は描画対象から外れて自動で破棄される。溜まり続けない
- 描画は `<Activity key={worktreeId} mode={selected ? "visible" : "hidden"}>` の列挙

## 決めること

### 4. タブ切替の扱い — 方針決定 (同じパターンを適用)

- ExplorerPanel 内で Changes / Files / Search の 3 pane を Activity で並べ、
  選択タブだけ visible にする
- hidden になった pane の後始末 (watcher 解除・実行中検索のキャンセル) は
  既存の effect cleanup がそのまま担う
- これで「同一 worktree 内でタブを離れると展開・検索語が消える」既存問題も一緒に解消する

### 5. 初 mount のタイミング前提 — 決定 (main worktree だけ例外)

- task worktree は「active になる時点で必ず mount 済み (選択されて visible で入った)」が
  導出集合でも成り立つ。runtime は表示中の SessionView からしか作られないため
- main worktree は常時描画のため hidden で初 mount するが、terminalRuntimeId の
  initializer が session prop に依存しない (常に null 始まりで、取得は表示時の
  auto-open effect) ので問題ない
- 将来「表示していない worktree でセッションを開始する」機能を入れる時は、
  この前提を見直す

## 検証項目 (推測で書かない)

6〜8 は 1 本のスパイクブランチでまとめて検証する (SessionView を雑に Activity で包み、
terminal / IME / preview / タブを実機で触る)。13 の絶対値計測も同じスパイクで行う。

### 6. Activity の実挙動

hidden で effect unmount (cleanup 実行) + state / DOM の保持、復帰で effect 再実行、
hidden への更新は低優先度で適用される、を公式ドキュメントと実挙動で確認する。
installed React (19.2.7) が `Activity` を export していることは確認済み。

### 7. xterm / IME

hidden で `term.dispose()` (TerminalPanel の effect cleanup) が走り、復帰の再生成 +
main (headless xterm) からの復元が、今の remount と同一に動くか。
IME はこの repo で前科があるため実機確認必須。

### 8. lazy + Suspense との組み合わせ

DiffPreviewPanel の EditModeEditor / HtmlPreview / MarkdownPreview は
lazy + Suspense。hidden / 復帰と干渉しないか。

### 9. scroll 位置 — 決定 (期待値に入れない)

display:none 中の scroll 位置の保持はブラウザ挙動に依存するため、
期待値に入れない (残ればおまけ)。

## 恒久的なコスト (一度払って終わりではない)

### 10. イベント購読で同期する state の規律 — 縮小して合意

主要な該当だった terminalRuntimeId は課題 2 の解決で消えた。
「hidden 中はイベント購読が落ちている」という性質自体は残るので、イベント購読で
local state を同期する state を今後足す時の考慮事項として、実装時に architecture.md へ
残す (課題 15 と一緒に)。

### 11. effect の「復帰で再実行される」前提の規律 — 合意 (B 特有ではない)

「effect は再実行されても壊れないように書く」は React の contract であって、
B はそれをサボれなくするだけ。課題 1 がその初仕事。

### 12. E2E セレクタが hidden DOM に当たる問題

hidden instance の DOM は残るので、既存テストの locator が複数マッチしたり、
count / text のアサーションが壊れうる。既存 e2e の全セレクタの監査が必要。

### 13. hidden instance の再描画コスト — 対策方針決定 (根絶は P22)

繰り返し発生する再描画トリガは session preview / activity の push (active session 数に
比例)。PTY の出力ストリーム自体は hidden instance に届かない (購読 effect が落ちていて
xterm も dispose 済み。renderer に届くのは小さな push だけ)。

問題の実体は 2 段: (1) SessionView に memo がなく App の再描画で全 instance が
render される。(2) `applySessionUpdate` が push のたびに全 worktree オブジェクトを
作り直すため、memo を入れても props の参照が毎回変わって効かない。

- **F51 での対策**: `applySessionUpdate` を参照保存スタイルに直し (隣の
  `applyPullRequestUpdates` が既にこの形で、コメントに意図も書いてある)、
  `memo(SessionView)` を入れる。push は該当 worktree の instance だけを
  低優先度で再描画する形になる
- **回帰テスト**:
  - unit: 「push に該当しない worktree は変更前と `===` で同一。該当がなければ
    prev そのものを返す」を applySessionUpdate / applyPullRequestUpdates の両方に
    固定する。App.tsx は xterm の css を import していて `node --test` から
    読めないため、対象関数を独立ファイルへ移す
  - e2e: SessionView に worktreeId キーの描画カウンタを仕込み (既存の YURU_E2E 系
    フラグと同じ流儀でゲート)、「worktree B の session が push を流している間、
    無関係な A (visible) と main worktree (hidden) のカウンタが増えない」を assert する。
    B の preview / activity の変化を push が届いた証拠にする。時間の閾値を使わない
    のでフレークしない
- **絶対値 (CPU / 描画時間)**: スパイク時に Profiler で一度計測して記録するだけ。
  マシン依存で必ず腐るので CI の pass / fail にはしない
- **根絶は P22**: worktree の表示データを worktreeId 単位の取得・購読に変えれば
  ブロードキャスト自体が消え、この対策ごと不要になる。F51 の対策は関数 1 個の
  書き換えなので、将来捨てても惜しくない規模

### 14. メモリ — 解決

instance 数 = repo の main worktree 数 + 同時に active な session 数 + 選択中 1 で
有界。eviction は不要。

## ドキュメント・コメントの追従

### 15. P20 前提の記述の書き換え

「unmount されるので古い結果が引き戻さない」前提のコード内コメント
(SessionView の isStartingRef まわり等) と、architecture.md の
「SessionView は worktree ごとに作り直す (P20)」の節を新しい前提に合わせる。
課題 10 の規律 (イベント購読で同期する state の注意) もここで architecture.md に足す。
