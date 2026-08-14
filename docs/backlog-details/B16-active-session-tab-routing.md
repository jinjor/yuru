# B16 primary を移した active session のタブが移動先 worktree に表示されない

Last updated: 2026-08-13

## つまり何が問題か

terminal のタブは live runtime と 1:1 で表示する。provider runtime のタブを表示する
worktree は、session ID が判明した後は
`runtime → agent session → primary link → task worktree` から導出する。
Codex の起動直後のように session ID がまだ分からない期間だけ、runtime を起動した
worktree を暫定表示先として使う。既知 session に primary がない場合、その runtime は
task worktree のタブ一覧に属さない。

## 観測された症状

次の操作で起こりうる。

1. worktree A の primary session が Yuru 上で active になっている。
2. その同じ session が Yuru を介さずに Git worktree B を作る。
3. 新しい agent session は作らず、同じ session が B でコマンド実行やファイル編集を続ける。
4. Git worktree watcher により、Yuru の左ペインへ B のカードが現れる。
5. B の Terminal ホームに同じ session が suggested かつ active として表示されるが、
   B の runtime タブ一覧には現れない。
6. その active suggested session をクリックしても terminal が表示されない。

完全な GUI 再現は未実施だが、2026-08-13 にコード上の経路を確認した。
session detection、suggested session assembly、active 判定、primary の移動に関係する
unit test 73 件も通過しており、各条件が組み合わさるとこの状態になることは確認済み。

## 現行実装で起きていること

### 1. 同じ session が B の suggested として検出される

Codex は session log 内の command cwd や変更 path、Claude は cwd や tool の
`file_path` を worktree の手掛かりとして読む。したがって、A で開始した session が
B で作業すると、同じ provider session ID が B の suggested session にもなりうる。

suggested は agent store の path hint から作る weak candidate なので、この検出自体は
想定された挙動である。同じ session が複数 worktree の suggested になることもありうる。

### 2. B でも active と表示される

`src/main/service.ts` の `getTerminalRuntimeIdsBySessionKey` は、live runtime を
`provider + agentSessionId` で引ける map にする。`src/main/repos/repo-list.ts` は
primary / suggested の session key がこの map にあれば active と判定する。

active は「その agent session に live runtime がある」という worktree 非依存の状態を表す。
A で開始した runtime が生きている間、B の suggested に表示された同じ session も active になる。

### 3. B にタブが出ない

一方、`getAllTerminalRuntimeIdsByWorktreePath` は `TerminalRuntimeInfo.worktreePath`、
すなわち runtime 作成時に渡された worktree path で runtime を分類する。その結果を
`WorktreeListItem.activeTerminalRuntimeIds` として renderer へ渡し、Terminal のタブを
組み立てている。

runtime は A 向けに起動されたため、同じ session が B の suggested / primary になっても
runtime ID は A の一覧に残り、B の一覧には入らない。

### 4. B の active suggested をクリックしても表示できない

クリックすると `resumeSuggestedWorktreeSession` が session を B の primary に昇格する。
`attachPrimarySessionByPath` は「1 agent session は同時に複数 task worktree の primary に
ならない」という制約を適用するので、同じ session の A の primary link は外れる。

その後 `resumePrimaryWorktreeSession` は同じ session key の live runtime がすでにあるため、
新しい PTY を起動せず既存 runtime ID を返す。renderer はその ID を選択状態にするが、
B の `activeTerminalRuntimeIds` に含まれないため `displayedTerminalRuntimeId` は `null` に
導出され、ホームのままになる。

さらに、primary のない worktree に provider runtime があれば runtime の
`worktreePath` から `agentSessionKey: null` の primary item を合成する fallback がある。
この fallback は session ID がすでに判明している runtime にも適用される。そのため
primary を B へ移した後も、A に匿名の active primary と runtime タブが残りうる。

## 成立させるモデル

### 永続 session と live runtime を分ける

- agent session
  - provider store に保存され、provider と agent session ID で識別する
  - Yuru metadata の primary link により、同時には最大 1 つの task worktree の
    primary になる
- terminal runtime
  - Yuru が起動している live PTY
  - provider runtime は、ID 判明後に agent session と対応する
  - standalone terminal は agent session を持たない
- launch target worktree
  - runtime の作成を依頼した worktree
  - worktree context の注入、ID 未確定中の暫定表示、startup failure の説明などに使う
  - provider session ID 確定後のタブ所属を表すものではない

`TerminalRuntimeInfo.worktreePath` は現在これらの意味を兼ねている。少なくとも概念上は
`launchWorktreePath` として扱い、primary link から導出する現在の表示先と区別する。

### タブと選択状態

タブは live terminal runtime と 1:1 の密な表示であり、runtime の生成で現れ、終了で消える。
選択状態は `selectedTerminalRuntimeId` で表す。TerminalPanel は選択中 runtime ID を使って
PTY の attach、入出力、resize、kill を行う。

ただし、各 runtime をどの worktree のタブ一覧へ載せるかは次の順で導出する。

1. provider runtime かつ agent session ID が判明済み
   - session key と一致する primary link を探し、その primary worktree に載せる
   - primary がなければ、どの task worktree のタブ一覧にも載せない
2. provider runtime かつ agent session ID が未確定
   - launch target worktree に暫定タブとして載せる
   - renderer 用には現行と同様、`agentSessionKey: null` の暫定 primary item を合成してよい
3. standalone terminal
   - agent session / primary link を持たないので、launch target worktree に載せる

概念図:

```text
provider runtime
├─ agent session ID 判明済み
│  └─ runtime → session → primary link → 表示先 worktree
└─ agent session ID 未確定
   └─ runtime → launch target worktree（暫定表示だけ）

standalone terminal
└─ runtime → launch target worktree
```

launch target による routing の適用条件は `agentSessionId === null` である。
ID はあるが primary がない状態は、active suggested、detach 後、metadata 不整合などを表し、
どの task worktree にも所属しない runtime として扱う。

## Codex の session ID 遅延解決

Codex は runtime を起動した直後には agent session ID が分からない。
現行実装は runtime を `agentSessionId: null` で登録してすぐ表示し、バックグラウンドの
`resolveLazySessionId` で ID を解決する。ID が分かると runtime を更新し、同じ launch target
worktree の primary metadata に session を attach してから repo 一覧を更新する。

ID 未確定中の暫定表示は terminal runtime ID で識別する。

1. ID 未確定中は launch target worktree に暫定 runtime タブを出す。
2. ID が解決したら runtime と実 session を紐づける。
3. 同期的に同じ worktree の primary へ attach する。
4. 次の一覧取得からは primary link 経由の正式な表示へ切り替える。

画面上のタブ位置は変わらず、表示根拠だけが暫定 link から primary link に切り替わる。
runtime map の ID 更新と metadata attach の間に一覧取得が割り込んでタブが一瞬消えないよう、
更新・通知順はテストで固定する。

以前は `provider:runtime:<startedAt>` 形式の `toRuntimeSessionKey` を一時 session ID として
使っていたが、commit `8806771` (`Remove runtime session key fallback`) で削除済み。
現在は `agentSessionKey: null` の暫定 primary item と terminal runtime ID が、ID 未確定 runtime
の view model を構成する。実 agent session ID の確定後は primary metadata の item に切り替わる。

## 期待する操作

### active primary を選ぶ

primary session item が持つ `activeTerminalRuntimeId` を選択する。既存 PTY を再利用し、
同じ runtime の未送信入力と scrollback を継続表示する。

### inactive primary を選ぶ

session の resume を backend に依頼する。成功時に返る runtime ID を選択し、一覧更新後に
その runtime が primary worktree のタブへ現れる。

### active suggested を選ぶ

session を選択中 worktree の primary に昇格する。既存 runtime を再利用し、その runtime の
タブ表示先は新しい primary link に追従する。元の primary worktree からはタブが消える。

今回の A → B では次が期待値となる。

- 昇格前: A に runtime タブがあり、B には active suggested 行だけがある
- B でクリック: session の primary link が A から B へ移る
- 昇格後: A のタブが消え、同じ runtime のタブが B に現れて選択される
- runtime ID と runtime 数は変わらず、未送信入力や scrollback も継続する

## worktree 削除への影響

現行の `stopTerminalRuntimesForWorktree` も `TerminalRuntimeInfo.worktreePath` だけで停止対象を
決めている。そのため、A で起動した active session の primary を B へ移した後は次の逆転が
起こりうる。

- A を削除すると、現在は B の primary である runtime を停止する
- B を削除しても、その primary session の runtime を停止しない

また、1 つの session が複数 worktree でコマンドや編集を行い、複数の suggested link を
持つこともある。suggested link は weak candidate であり、runtime lifecycle の所有関係には
使用しない。

修正時にはタブだけでなく削除の停止対象も必ず再確認する。候補となる原則は次のとおり。

- ID 判明済み provider runtime: 現在の primary link を停止対象の所属として扱う
- ID 未確定 provider runtime: launch target worktree を暫定的に使う
- standalone terminal: launch target worktree を使う
- primary のない既知 provider runtime: product 上の停止対象 worktree は未所属とし、実際に
  worktree を cwd とする process は既存の `lsof` による live process 確認で検出する

ただし、「primary のない既知 runtime をどの操作で停止できるようにするか」と、削除時に
primary link を runtime lifecycle の所有関係として採用するかは、実装前に最終確認する。
B16 の実装範囲には、worktree 削除時の停止方針を明示的に決める作業を含める。

## 実装の方向性

修正対象は、main process が各 `WorktreeListItem.activeTerminalRuntimeIds` を組み立てる経路である。

- metadata の全 primary session から `session key → primary worktree path` を作る
- live runtime を走査し、上記ルールで表示先 worktree を決める
- `getAllTerminalRuntimeIdsByWorktreePath` の「runtime の launch path で常に分類する」実装を
  この導出へ置き換える
- primary 不在時の runtime 由来 primary item 合成は、agent session ID 未確定の provider
  runtime だけに限定する
- `getTerminalRuntimeIdsBySessionKey` による active 判定と、primary item の
  `activeTerminalRuntimeId` を session と runtime の対応に使う
- renderer は `selectedTerminalRuntimeId` を選択状態として持ち、TerminalPanel と PTY IPC に渡す

同じ agent session に複数の live runtime ができると `getTerminalRuntimeIdsBySessionKey` の
map が暗黙に後勝ちになる。現行 UI は active primary の再選択で既存 PTY を再利用するため
実質的に「1 agent session = 最大 1 live runtime」を前提としている。この前提を明示し、
少なくとも通常の resume / promote 経路で重複 runtime を作らないことをテストする。

## テスト観点

### main / unit

- runtime の launch target が A、同じ session の primary が B の場合
  - A の `activeTerminalRuntimeIds` に runtime が入らない
  - A に runtime 由来の匿名 primary が合成されない
  - B の primary が active になり、`activeTerminalRuntimeId` が runtime を指す
  - B の `activeTerminalRuntimeIds` に runtime が入る
- active session が B の suggested にだけ存在する場合
  - suggested 行は active
  - B の runtime タブ一覧にはまだ入らない
- agent session ID 未確定の provider runtime
  - launch target worktree に暫定 primary と runtime タブが出る
- agent session ID は判明しているが primary がない runtime
  - すべての task worktree の `activeTerminalRuntimeIds` がその runtime を除外する
- standalone terminal
  - launch target worktree のタブに残る
- Codex の ID 解決
  - 暫定 runtime 表示から正式な primary 表示への切り替えでタブが消えない
- resume / promote の同時操作後も、同じ agent session の live runtime は最大 1 件になる

### E2E

今回の A → B のシナリオを固定する。

1. A の primary session を active にする。
2. 同じ session のログへ B の cwd / file change evidence を加え、B で active suggested として
   検出させる。
3. 昇格前は A にだけ runtime タブがあり、B には active suggested 行だけがあることを確認する。
4. B の suggested 行をクリックする。
5. A からタブが消え、B に同じ runtime のタブが現れて選択されることを確認する。
6. PTY に未送信の probe を残し、昇格後も同じ内容が見えることで runtime を再作成していないと
   確認する。

worktree 削除の方針を決めた後は、primary を A から B へ移した状態で A / B をそれぞれ削除する
テストを追加し、意図した runtime だけが停止することも固定する。

## 完了条件

- active suggested を primary に昇格すると、既存 runtime のタブが新しい primary worktree に現れ、
  クリックした操作でそのまま表示される
- 元の primary worktree の runtime タブ一覧と primary 一覧から対象 session が消える
- ID 未確定中の Codex runtime は起動対象 worktree に表示され、ID 解決時にちらつきや消失がない
- 既知 session に primary がない場合、その runtime はすべての task worktree のタブ一覧から外れる
- standalone terminal は launch target worktree に表示され、選択と kill が動作する
- active / waiting / working の表示と session preview は移動後の primary worktree で更新される
- worktree 削除時の runtime 停止方針を明示的に決め、必要な実装とテストを同時に行うか、
  別 item に分ける場合はその依存関係を backlog に残す

## 関連

- `docs/architecture.md`: primary session、suggested session、terminal runtime の現行定義
- `docs/backlog-details/I21-primary-session-experience.md`: 「タブ = live runtime」の設計経緯
- `docs/backlog-details/F51-keep-alive-shell-separation.md`: renderer が runtime の生存を
  `activeTerminalRuntimeIds` から導出する経緯
- `src/main/repos/repo-list.ts`: primary / suggested の active 状態と runtime 一覧の assembly
- `src/main/service.ts`: runtime map、Codex ID 遅延解決、promote / resume、worktree 削除時の停止
- `src/renderer/worktrees/WorktreeView.tsx`: runtime の選択状態と表示可能性の導出
