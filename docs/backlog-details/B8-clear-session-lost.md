# B8 claude で /clear するとセッションが迷子になる

Last updated: 2026-05-16

`B8` は、claude セッション中に `/clear` を実行すると、その後 Yuru からそのセッションを
resume できなくなる不具合のメモ。
調査時点の実データを根拠として残す（このファイルは記録であり、以後メンテはしない）。

## 症状

- Yuru の一覧でセッションをクリックすると、端末に `No conversation found with ID: ...` が
  一瞬表示され、すぐに `Select a session to resume` 画面に戻ってしまう
- 一度 `/clear` したセッションで起きる。特に worktree を跨いだ後だと確実に再現する

## 何が起きているか

`No conversation found with ID: ...` は Yuru ではなく claude CLI 自身が出すエラー。
つまり Yuru は実際に `claude --resume <ID>` を起動したのに、claude 側がその会話を
見つけられず即終了している。Yuru から見るとこの即終了は「セッションが正常終了した」のと
区別がつかないため、選択を解除して resume 画面に戻す。

## 根本原因

3 つの事実が噛み合って起きる。

1. claude の会話ファイル（`<ID>.jsonl`）の保存先フォルダは、**そのセッション ID が
   生まれた瞬間の作業ディレクトリ**をエンコードしたものに固定される。後から cd しても動かない。
2. `/clear` は会話履歴を消すだけでなく、**新しいセッション ID を発番する**。その瞬間の
   作業ディレクトリ次第で、新しい会話ファイルの保存先フォルダが変わる。
3. `claude --resume <ID>` は「**今いる作業ディレクトリに対応するプロジェクトフォルダ**」の
   中だけから会話を探す。

Yuru は resume 時に repo root を作業ディレクトリにして `claude --resume` を起動する
（claude adapter の `createResumeLaunch` が `cwd: session.repoPath` を渡す）。
`/clear` 後の会話ファイルが repo root 以外のフォルダ（別の worktree）に作られていると、
Yuru がどの作業ディレクトリで resume しても当たらない。

さらに、Yuru の resume 前チェック（`hasStoredSession`）は「その ID がどこかに存在するか」
しか見ていない。`history.jsonl` に ID が載っているか、または `<ID>.jsonl` がどこかに
1 つでもあるか、だけ。**場所を一切考慮しない**ので、「repo root から resume したら
見つからない」ことを予測できず、そのまま起動してしまう。

## 調査時の実データ（2026-05-16）

- この会話のセッション ID は `/clear` を境に変わっていた:
  - `/clear` 前: `a884423c-299e-40a8-a362-a99830cab586`
  - `/clear` 後: `d79b20eb-b077-423a-8848-0cf2b6ff9190`
- `/clear` 後の会話ファイルの実体:
  `~/.claude/projects/-Users-jinjor-projects-yuru--claude-worktrees-f5-diff-overview-ruler/d79b20eb-....jsonl`
  → repo root でも、Yuru が紐付けている worktree でもなく、`/clear` 実行時に
  いた worktree のフォルダに入っていた
- Yuru のメタデータはこの会話を別 worktree の `primarySession`（ID `d79b20eb...`）として登録
- resume は repo root を作業ディレクトリにするので `-Users-jinjor-projects-yuru/` を
  見にいき、そこに `d79b20eb-....jsonl` は無い → `No conversation found`

## 補足: history.jsonl の `project` フィールドは当てにならない

`~/.claude/history.jsonl` の各エントリには `project`（例: `/Users/jinjor/projects/yuru`）が
あるが、これは履歴表示用のラベルにすぎず、`--resume` がファイルを探すのに使う値ではない。
実際の探索場所は、作業ディレクトリの実パスをそのままエンコードしたフォルダ名。
`project` を見て「repo root のセッション」と判断すると原因を見誤る。

## 関連

- `B3`（古いセッション選択時の `No conversation found` のちらつきを消す）はこの現象の
  UI 側の見え方。`B8` はその根本原因のうち `/clear` によるセッション ID／保存先の移動に焦点を当てる
- `I14`（metadata が壊れていた時の救済）と近い領域。「セッションに到達できなくなる」系

## 修正の方向性（決め打ちしない）

- resume 前チェックを「場所まで含めて」検証する。少なくとも「resume する作業ディレクトリの
  プロジェクトフォルダに該当 `<ID>.jsonl` が実在するか」を確認し、無ければ resume を起動せず、
  ユーザーに分かる形でエラーを出す（黙って resume 画面に戻さない）
- 失敗した resume を「セッション正常終了」と区別する。即終了した resume プロセスを検知して
  選択解除せずエラー表示にとどめる（`B3` と重なる部分）
- Yuru が会話ファイルの実際の所在から、resume すべき作業ディレクトリを逆算する
- より根本的には、Yuru が「セッション ID ↔ worktree」を固定対応として持つモデルを見直す。
  `/clear` や作業ディレクトリの変更でセッション ID と保存先が動く前提に合わせる必要がある
  （ここはモデルの再設計になるので、着手前に方針を相談する）
