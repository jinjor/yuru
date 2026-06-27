# F41 Worktree Removal

Last updated: 2026-06-28

`F41` は、Yuru の左ペインから task worktree を削除できるようにする機能。

Yuru の主導線は `repo > task worktree` なので、作業が終わった worktree を Yuru 内で片付けられないと、一覧が増え続けて使いにくくなる。
この item は repo 全体の Git cleanup ではなく、Yuru が表示している task worktree を閉じるための機能として扱う。

## Goal

- 不要になった task worktree を左ペインから削除できる
- 未コミット変更や untracked file は、ユーザーが明示した場合だけ捨てて削除できる
- open PR があると分かっている worktree は、削除に明示的な続行意思を必要とする
- その worktree で動いているプロセスを孤立させない（生きたプロセスがある間は削除させない）

## Target behavior

削除処理全体のフロー。入口は task worktree カードの `︙` メニューの `Remove worktree…`。
上から順に進み、各分岐とブロックを明示する。各判定の根拠は後続のセクション（Pull request / Dirty worktree / 削除前のプロセスチェック）に書く。

1. **メニューを開いた時点で、追跡中の session（primary / suggested）が active かを見る。**
   - active → `Remove worktree…` を無効化し「先に止めて」と添える。ここで終わり（→ UI のケース D）。
   - そうでない → 次へ。
2. **open PR があるかで確認ダイアログを出し分ける。** PR の有無は既に持っているメタデータで判定し、削除のために取りに行かない。
   - open PR あり → open PR 警告付きの確認ダイアログ (B) を出す。
   - なし → 通常の確認ダイアログ (A) を出す。
3. **Remove を押したら、その worktree で生きたプロセスが動いていないか OS に問い合わせる。**（Cancel なら終わり）
   - いる → 削除せず、開いている確認ダイアログの本文を「先に止めて」のブロック表示に差し替える。ここで終わり。
   - いない → 次へ。
4. **`git worktree remove <worktreePath>` を実行する。**
   - 成功 → 7 へ。
   - dirty で拒否された → 5 へ。
5. **force 確認ダイアログ (C) を出す。**（Cancel なら終わり）
6. **Force remove を押したら、3 と同じプロセスチェックをもう一度行い、`git worktree remove --force <worktreePath>` を実行する。**
   - プロセスがいる → ダイアログ本文を差し替えて終わり。
   - いない → 実行して 7 へ。
7. **削除に成功したら、Yuru metadata から対象 task worktree record を消す。** primary session link はこの record と一緒に消えるが、provider session 履歴自体は残す。

## UI

削除の入口と確認ダイアログのモックアップ: [docs/mockups/F41-worktree-removal.html](../mockups/F41-worktree-removal.html)

- 入口は task worktree カード右上の `︙`（ホバー / 選択時に表示、main worktree には出さない）。現状の項目は `Remove worktree…` のみ。これは UI 提案で、detail の確定仕様ではない。
- 確認ダイアログは通常 (A) / open PR 警告付き (B) / force (C) の 3 種類。生きているプロセスがある worktree（多くは active session）は、確認ダイアログを出さずメニュー段階でブロックする (D)。`Remove worktree…` を無効化し、理由（先に止めて）だけ添える。専用モーダルは持たない。
- Remove / Force remove を押した直前のチェックで生プロセスが判明したときは、新しいモーダルを開かず、開いている確認ダイアログの本文をブロック表示に差し替える（→ Target behavior の 3・6）。
- ダイアログは「何が消えて何が残るか」を最小限で伝える。dirty のファイル一覧・件数は出さない。

## Pull request

open PR は、worktree を削除すると作業を追いにくくなることを示す注意材料として扱う。
ただし削除の完全なブロック条件にはせず、削除する場合でも branch と PR は残す。

PR 情報は GitHub などの provider から取得できた場合だけ使う。
この item では remote branch や local branch から PR 相当の状態を推測しない。
誤って削除した場合の復帰導線は `F42` に寄せる。

## Branch cleanup

worktree と branch は別のものとして扱う。
worktree 削除は作業ディレクトリの削除であり、branch 削除は履歴への名前を消す操作である。

この item では branch を削除しない。
local branch cleanup は worktree を使わない通常作業でも起きる repo 管理の問題なので、Yuru の worktree 削除機能には背負わせない。

## Dirty worktree

dirty worktree を片付けられない削除機能は実用上つらい。
ただし `--force` は未コミット変更や untracked file を捨てる操作なので、通常削除とは別の明示確認にする。

force 削除では、少なくとも次を判断材料にする。

- 未コミット変更が消える
- untracked file が消える
- branch や provider session 履歴は削除しない

dirty の詳細なファイル一覧や件数は出さない。
必要ならユーザーは削除前に Changes / Files / Git CLI で確認できるため、削除確認は判断に必要な最小限の情報に絞る。

## 削除前のプロセスチェック

その worktree で生きているプロセスがある間は削除しない。先に止めてから消す。

### なぜ Yuru 側で防ぐ必要があるか

git はプロセスが動いていても止めてくれない。clean なら通常削除で、dirty なら force で、worktree ディレクトリも git の管理情報もそのまま消える。
消されたプロセスは死なずに残るが、作業場所（cwd）が消えた状態になり、以降のファイル操作・git 操作が全部失敗する。死なないぶん気づきにくい。
git が守ってくれないので、Yuru 側で先回りして防ぐ。

### チェックのやり方

「その worktree を作業場所（cwd）にしている生きたプロセスがあるか」を OS に問い合わせて判断する。これが削除可否の最終判定。

- cwd だけ見れば十分。開いているファイルハンドルは消しても閉じるまで生きるので幽霊化しない。
- ディレクトリ配下の再帰スキャンはしない（cwd 一覧を worktree のパスで絞るだけ）。軽い。

### なぜ 2 か所でチェックするのか

チェックは全体フロー（→ Target behavior）の 2 か所に入る。メニューを開いた時点（自分の状態を見るだけ）と、削除を実行する直前（OS に問い合わせる）。

メニュー段階のチェックだけでは足りない。session を止めても、setsid / nohup / デーモン化した子プロセスは生き残ることがあり、これらは追跡 session に現れないため捕まらない。だから削除直前に OS へ直接聞くチェックが要る。

逆に、削除直前のチェックだけでも安全側には倒れるが、それだと「消せると思って Remove を押したら拒否」が起きる。これが起きやすいのは追跡 session が active なケースなので、それをメニュー段階で先に止めて押させない。

「確認ダイアログを出す前にも OS へ問い合わせる」中間のチェックは持たない（YAGNI）。メニューを素通りしてなお生プロセスが残るのはレアで、削除直前のチェックで拾えば足りる。差し替えで対応するのはそのレアケースだけなので、専用 UI も作らない。苦しくなったら足す。

### スコープ外

- Yuru と無関係なプロセスがその worktree を使っている場合、Yuru から他人のプロセスを kill してまで閉じることはしない（激レア）。その時はユーザーが自分でプロセスを片付ける。
- active な session の停止まで 1 フロー（ダイアログから直接 Stop）にまとめるかは、この item の初期実装では扱わない。

## Commands

通常削除:

```sh
git worktree remove <worktreePath>
```

force 削除:

```sh
git worktree remove --force <worktreePath>
```

## Non-goals

- repo 全体の merged branch cleanup
- PR から task worktree を import する導線
- local branch の削除
- remote branch の削除
- remote branch や local branch から PR の有無を推測すること
- `git branch -D` による強制 branch 削除
- provider session 履歴の削除
- PR merge 時の自動整理

PR merge 時の自動整理は `F18` に寄せる。
