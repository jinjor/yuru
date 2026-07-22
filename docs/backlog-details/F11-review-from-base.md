# F11 ファイルごとのレビューチェック (F37 base 差分を含む)

`F11` は、GitHub の PR レビューの "Viewed" のように、ファイルごとに「見終わった」チェックを付けられるようにする機能。
`F37` (branch の diff 表示) はこの設計の中に含めて、スコープを絞って実装する。

設計は 2 つの柱でできている。

1. **Changes ペインを重複しない区間分割にする**: `Committed / Staged / Unstaged` の 3 セクションが
   「merge-base → HEAD → index → 作業ツリー」という層の連続した区間に 1 対 1 で対応する。
2. **チェックは「この内容にヨシを出した」というファイルごとの宣言 1 つ**にする。
   どの行が checked に見えるかは「承認した内容がいまどの層にいるか」から毎回導出する。

## 柱 1: Changes の区間分割と Committed セクション

### F37 のスコープ: 任意のコミット間はやらない

「レビュー済み」は差分に対して定義される状態なので、差分の範囲が動くと仕様が成立しない
(範囲ごとにチェックを持つのか、という問いが生まれて手に負えなくなる)。
実装するのは **Committed セクション = merge-base ↔ HEAD (commit 済みのみ)** の表示だけ。
コミット単位で読みたい欲求が残る場合は、レビュー状態と切り離した純粋なビューア機能として別 item にする。

範囲の元側は GitHub PR と同じ three-dot 相当 (`merge-base(base, HEAD)`)。
base 側が先に進んでも、この branch が触っていない変更はレビュー対象に混ざらない。

### セクション構成

Review の独立タブは作らない。既存 Changes タブのセクションを次の順にする。

| セクション | 区間 | 意味 |
|---|---|---|
| Conflicted | (例外状態) | 既存のまま。チェックは付けない |
| Committed | merge-base ↔ HEAD | この branch が commit した仕事の全体 |
| Staged | HEAD ↔ index | commit 直前の内容 |
| Unstaged | index ↔ 作業ツリー | いちばん新しい仕掛かり |

- 3 区間は**互いに重ならない**ので、同じ差分が 2 セクションに出ることが原理的にない
  (同じファイルが別区間の別内容で出ることはあり、それは情報)。
- `Committed / Staged / Unstaged` は同じ文法の並びで、「内容がどの層にいるか」を名前が語る。
- 並び順は**変動するものほど下**: agent の編集で一番動く Unstaged を最下部に置き、
  上のセクションがガクつかないようにする。Staged が Unstaged の上なのは VSCode とも同じ。
  Conflicted だけは例外状態として最上部で目立たせる。
- **Committed は既定で折りたたむ**。普段の関心は直近の変更 (Staged / Unstaged) で、
  Committed を見るのはレビューの時。折りたたみ中もヘッダで件数と合計 +/- は見える。
  展開状態は renderer のローカル state (worktree 切替やアプリ再起動で既定に戻る)。
- untracked は今まで通り Unstaged にだけ出る (未コミットなので Committed に出ようがない)。
- agent が commit し終えると Staged / Unstaged は消え、Committed だけが残る
  = レビューの時間には自然にレビューリストが主役になる。
- セクションヘッダは ラベル + 合計行数。**件数は出さない** (リストを見れば分かるし、
  総数は Changes タブの badge にある)。レビュー進捗の分数 (4/12 など) も出さない。
  ラベルの左端は縦に揃え、Committed の折りたたみ chevron は左余白に置く。
- **Committed のヘッダには解決した base の branch 名を添える** (muted な mono 表示)。
  fork point 推測の結果がそのまま見えるので、推測が外れた時の診断口も兼ねる。
- branch が base そのもの (main worktree 含む) の場合、merge-base = HEAD なので
  Committed は常に空になり、空セクションとして非表示になる。特別扱いのコードは書かない。

### base の解決

git には「branch がどこから生えたか」という情報が存在しない (branch はただの ref で、
commit は branch を知らない)。親 branch を扱うツールは自前保存 (git-town / graphite) か
推測 (git-machete は reflog 走査) を選んでいて、推測派も不完全さを明言して手動 override を
用意している。Yuru に必要なのは「親 branch の名前」ではなく **diff の元側になる fork commit**
なので、reflog より頑健な merge-base 比較のヒューリスティックで推測する
(reflog は expire するが、merge-base は現在の ref だけから決まる):

1. 現在の branch が repo のデフォルトブランチ (origin/HEAD) そのものなら base = 自分自身。
   Committed は常に空になり、セクションは非表示。
2. 候補 = 自分以外の **local branch 全部**。origin/HEAD の branch が local に無ければ加える。
3. 各候補と `git merge-base <candidate> HEAD` を取り、履歴が繋がらない候補は除外する。
4. **`git rev-list --count <mb>..HEAD` が最小の候補**の merge-base を base に採る
   (fork point が HEAD に一番近い branch を親とみなす、デファクトのヒューリスティック)。
5. 同着はデフォルトブランチ優先、残りは branch 名順 (決定的にするためだけの規則)。
   同着 (兄弟 branch) は merge-base 自体が同じ commit であることがほとんどで、
   その場合どれを選んでも diff は同一。tie-break が影響するのは tooltip の表示だけ。
6. 候補が 1 つも残らなければ、Committed セクションの位置に**明示的なメッセージ**を出す
   ("Base branch is unknown" 相当)。黙って非表示にしない。
   このときチェック機能全体が成立しない (fingerprint が base に依存する) ので、チェックも表示しない。

- 自己修復的な性質がある: 親 branch が base にマージされて消えると fork point が深くなり、
  Committed は自分の commit だけに自然に縮む。自分の branch がマージ済みなら距離 0 で
  Committed は空 (レビュー対象なし = 正しい)。
- 既知の外れ方: 自分の branch の複製や旧 tip を指す branch が残っていると、そこが fork point
  とみなされて Committed が痩せる。まれで、ヘッダに出る base 名から診断できる。
- 解決結果の branch 名は Committed のセクションヘッダに表示する。手動切替 UI・
  worktree 作成時の記録・PR base への連動は持たない (解決ルールを 1 本に保つ)。
- 解決は HEAD と branch tip 群が変わった時だけ計算してキャッシュする
  (3 秒ポーリングの度に全候補の merge-base を回さない)。

## 柱 2: チェック = 「base からこの内容まで見た」宣言

### 記録

ファイルごとに record は最大 1 つ:

```
path → (base 側 blob OID, ヨシを出した内容 X の blob OID)
```

- 「base の内容からファイルの内容 X までの差分を見た」という宣言。
- 存在しない側 (新規追加の base 側 / 削除の X 側) は `-`。
- rename されたファイルは rename 元 path で base 側 blob を引く (record の key は rename 先 path)。
- チェック解除 = record の削除。それ以外で record は消さない。

### 表示規則 (1 つだけ)

> 各行は「**その行の右側 (新しい側) の内容 == X**」かつ「record の base 側 == 現在の merge-base の blob」なら checked。

- Unstaged 行の右側 = 作業ツリーの内容、Staged 行 = index の内容、Committed 行 = HEAD の内容。
- チェックはイベントで付け外しされるのではなく、この比較から**毎回導出**する。
  「レビュー後に更新されたファイルはチェックが外れる」は仕組みとして自動で成立する。
- commit や stage という操作自体はチェックに触らない。内容が層を移動した結果として表示が追従する。

### この意味論で成立する流れ

- **未コミットのレビュー**: Unstaged の diff を見てチェック (X = 作業ツリーの内容)。
  agent がその内容のまま commit すると、Unstaged 行は消え、**Committed 行が checked で現れる**。
  チェックが内容と一緒に層を降りていく。commit = ヨシ、がそのまま成立する。
- **commit 済みのレビュー**: Committed の diff を見てチェック (X = HEAD の内容)。
  agent が新しく編集すると Unstaged に unchecked 行が積まれるが、Committed 行は checked のまま
  (承認済みの commit 内容は変わっていない)。その編集が commit された時点で HEAD が X とズレ、
  Committed 行も unchecked になる。
- **revert**: 内容が X に戻れば checked も自動で戻る (その差分は見たことがあるので正しい)。
- **rebase**: base 側 blob が変わったファイルだけ unchecked になる (上流が触っていないファイルの
  チェックは生き残る)。

### 割り切り

- **増分だけ見てチェックするのは自分の判断**。base→A が未チェックのまま A→B の差分だけ見て
  チェックすると「base から見た」という過剰宣言になるが、個人ツールなのでシステムは咎めない。
- **部分 stage 中**は index が中間内容になり、Staged 行だけ unchecked になりうる。
  agent 運用ではほぼ起きないので許容する。

## UI

モックアップ: [docs/mockups/F11-review-pane.html](../mockups/F11-review-pane.html)

### リスト表示

- レビュー済みの印は**ファイル名の取り消し線だけ** (dir までは引かない。視認できる太さにする)。
  status の色・ディレクトリ・行数はそのまま残す。
  レビュー状態は変更の種類より重要度が低い情報なので、リストをレビュー中心のデザインにしない。
- **dir はファイル名の真横 (左寄せ)** に置き、パス全体として後ろ省略する (あふれるのは dir 側)。
  F40 ヘッダと同じ「関心が同じものを隣接させる」配置で、取り消し線とは独立のレイアウト変更。
- リストにチェックの操作 UI は置かない (表示専用)。付け外しは diff パネルの Reviewed トグルで行う。
- **チェックしても行は移動しない**。並び順は P18 のポリシーに従う。

### diff パネル

- `GitDiffScope` に `"base"` を追加する。元側 = merge-base の blob、現在側 = **HEAD の blob**。
  両側が blob なので**編集モードには入れない** (staged と同じ制約。nit を直すときは Files から開く)。
- **ヘッダに範囲ラベルを出すのは Committed の diff だけ**: `from <base>` の形で branch 名を含める。
  文字種の違う短いラベルを 4 つ並べても文字を読まないと区別できない (視認性が悪い) ので、
  新しく増える Committed とそれ以外がラベルの有無で見分けられれば足りる。
  Staged / Unstaged / scope なし (Files やターミナルリンク) は従来通りラベルなし。
- **Reviewed トグル**を変更のあるファイルの全 scope で出す。意味は常に
  「この画面の右側の内容までヨシ」(scope `unstaged` / scope なし = 作業ツリー、`staged` = index、`base` = HEAD)。
  読み終わったらその場でチェックして、リストに戻って次を開くループにする。

## データと実装

### 保存

`~/.yuru/file-reviews.json` (新規ファイル):

```json
{
  "worktrees": {
    "/abs/path/to/worktree": {
      "src/foo.ts": "<baseBlobOid>:<approvedBlobOid>"
    }
  }
}
```

- OID は **git の blob OID 形式**に統一する。作業ツリーの内容も
  `sha1("blob <byteLength>\0" + content)` で git と同じ値を計算できる (`git hash-object` と一致確認済み)。
  こうしておくと、承認した内容が一度でも stage / commit されていれば odb にその blob が残るため、
  将来「前回レビューからの差分」(承認済み blob ↔ 現在) を `git cat-file` だけで出せる (v1 では作らない)。
- `metadata.json` には入れない。metadata は「主導線を組み立てる最小限の情報」で、
  レビューチェックは書き込み頻度もライフサイクルも違う (チェックのたびに書く)。
- worktree を Yuru から削除したとき、その worktree の record も削除する。
  Yuru 外で worktree が消えた場合の残骸は掃除しない (小さく、無害)。

### IPC

- `getReviewState(worktreeId)` →
  `{ kind: "no-base" } | { kind: "ready"; baseBranch; committedFiles; workingChecks }`
  - `committedFiles`: Committed セクションの行 (`path`, `status`, `lineStat`, `reviewed`)。
  - `workingChecks`: Unstaged / Staged 行に重ねる checked 状態 (`path`, `unstagedReviewed`, `stagedReviewed`)。
  - reviewed は main 側で導出して返す (fingerprint を renderer に出さない)。
  - base を解決できないのは異常ではなく状態なので、`Result` の error ではなく data の variant で返す。
    git 実行自体の失敗は普通に error。
- `setFileReviewed(worktreeId, path, layer, reviewed)`
  - `layer: "worktree" | "index" | "head"` で X をどの層の内容にするか指定する
    (Reviewed トグルの scope から一意に決まる)。チェック時はその時点の (base blob, X) を保存、
    解除時は record 削除。
- ポーリングは `gitPathStates` と同様に SessionView が 3 秒間隔で持つ。

### git コマンド (scratch repo で挙動確認済み)

1. base 解決 = fork point の推測 (上記)。`git merge-base <candidate> HEAD` と
   `git rev-list --count <mb>..HEAD` を候補ごとに回す (兄弟 branch の同着と
   branch-off-branch の判別は scratch repo で確認済み)
2. Committed の一覧と両側 blob OID: `git diff --raw --numstat --find-renames -z --no-abbrev <mergeBase> HEAD`
   - 2 コミット間の `--raw` は両側の OID が実値で出る (作業ツリー相手と違い `0{40}` にならない)。
     既定では省略形なので `--no-abbrev` を付ける
3. index 側の blob OID: `git ls-files -s` (計算不要でそのまま取れる)
4. 作業ツリー側の blob OID: status に出ているファイルだけ Node で計算 (上記の blob OID 形式)

### 落とし穴 (実装時の注意)

- scope なし diff の「status が clean なら元側 = 現在側」というショートカットは
  **scope `base` には使えない**。HEAD に対して clean でも merge-base とは差分がある。
- rename の base 側 blob は rename 元 path で引く必要がある (`--raw --find-renames` の src OID を使う)。
- 作業ツリー側のハッシュ計算は unstaged に出ているファイルだけに限定する。
  重かったら mtime+size キャッシュ等を検討するが、実測前にはやらない。

## 対象外 (割り切り)

- 任意のコミット間の diff (F37 の元の文言)。必要が残れば別 item。
- 「前回レビューからの差分」表示。blob OID 形式の採用で拡張路だけ確保し、v1 では作らない。
- base の表示・手動切替 UI・worktree 作成時の記録・PR base (`baseRefName`) への連動。
  fork point の推測 1 本にする。
- GitHub のレビュー画面のように全ファイルの diff を縦に並べる表示。一覧と詳細の往復自体を
  消せる将来案として覚えておく (チェック操作の置き場問題も一緒に消える)。
- Conflicted 行へのチェック付与。
- ファイルモード (chmod) だけの変更の検出。fingerprint は内容のみを見る。
- レビュー状態の worktree 間・branch 間の引き継ぎ。
- 増分レビューの正当性チェック (transitivity の検証)。ユーザーの判断を信頼する。

## Acceptance

- Changes タブが `Conflicted → Committed → Staged → Unstaged` の順になり、
  Committed に merge-base ↔ HEAD の変更ファイル一覧が出る。同じ差分が 2 セクションに出ることはない。
- Committed は既定で折りたたまれ、ヘッダで base の branch 名と合計 +/- が見える。
- レビュー済みのファイルは、リスト上でファイル名の取り消し線として常時見分けられる。
- チェックの付け外しは diff パネルの Reviewed トグルで行える (全 scope、意味は「右側の内容までヨシ」)。
- レビューした内容がそのまま commit されると、チェックが Committed 行に引き継がれる。
- レビュー後にファイルが変更されると (agent の編集・自分の編集・rebase いずれでも)、
  該当する行のチェックが導出で外れる。
- Committed の diff のヘッダにだけ `from <base>` ラベルが出る (他の scope はラベルなし)。
- base は fork point の推測 (全 local branch との merge-base 比較、最短距離) で自動解決され、
  候補が無ければ Committed セクションの位置にその旨が明示される。
- チェック状態は app を再起動しても保持され、worktree を Yuru から削除すると消える。
