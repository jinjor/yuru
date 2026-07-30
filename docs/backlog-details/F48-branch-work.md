# F48 分岐した作業のために新しい task worktree を作成できるようにする

Last updated: 2026-07-30

このドキュメントはアイデア出しの記録。設計はまだ確定していない。
スパイク結果と実装レベルの設計は [F48-detailed-design.md](F48-detailed-design.md) にまとめた。

## 発端 (ユーザーの要望)

以下は最初にユーザーが書いた要望をそのまま引用したもの。

> 1. 作業分岐
> worktree で何かタスクをやっている時に別のことをやりたくなったとする。
> 同じセッションで複数のことをやらせていると、だんだん何が何だかわからなくなる。
> そこで、yuru の新規 worktree で分岐した作業をやらせたい。
> ところが、今は文脈を全部全部引き継ぐために人間が頭で記憶して頼み直すか、GitHub issue か何かにメモっておいて「これを読んで作業して」と頼まないといけない。
> 後者は記録が残るのがメリットだが、手間は手間。
> なので、エージェントに新しい worktree + session を作ってもらう...という体験を考えてた。
> ここまで書いて思ったけど、これもしかしてエージェントに依頼プロンプトを > pbcopy してもらうだけでいいかな？
> /tmp 以下の .md で申し送りっていう手もある。
>
> 2. レビュー
> ある worktree での作業を別の worktree の新規セッションからレビューしてもらいたい。
> この時に、どの worktree で何をやっていて...みたいなことを説明しないといけない。
> /code-review は同じ系列のモデルにしか頼めないし /codex:review は会話を引き継げない（だから文脈を理解せずに頓珍漢なレビューになる）し /codex:transfer は会話を引き継げるけど会話の続きとして頼まないといけないからちょっと不自然かも？あと /codex 系は claude -> codex の時しか使えないよね。
> あとこういうスキルは実装者が頼んでいるから、観点の伝え方が実装視点に寄りそうだし勘違いした仕様をそのまま伝えてレビューにならなそう。
> というわけで、なんとかサッとレビューを始められるようにしたい。
> あとはレビュー結果を伝える時も、レビュワーに「/tmp 以下に .md を置いて」と頼んで、実装者に「/tmp/xxx.md を読んで」みたいな伝え方をしないといけなくて、これも地味に面倒。
> まあこれも > pbcopy でいけるのかな？頼まなきゃいけないのは同じか。
> セッション同士で会話させたいよな、本当は。
>
> ...みたいなことをしたい。
> で、上にも書いた通り代替案はあるので、必ずしも yuru に機能追加しないといけないわけではないんだが、気の利いた機能があれば便利になると思う。
> ブレストなのであえて面白い案を挙げると、yuru MCP にアクセスさせるとかも考えられる。エージェントが yuru の機能を使えるようにする。
> あとはセッションのダンプを汎用的にしてボタンひとつで取り出せるようにすれば会話を渡しやすいかも。
> あとはセッション同士を会話させるプロトコルとか。
> yuru 経由じゃなくても worktree + session をエージェントが立ち上げたらそれが yuru から見えるようになってもいいかもしれない？

## 会話で追加で分かった要望・制約

- レビュー対象には未コミットの変更も含む。
  Git は同じ branch を 2 つの worktree で checkout できず、detach で同じコミットを出しても
  未コミットの変更は見えないので、レビュワーは対象 worktree のファイルを直接読める必要がある
- 今のレビューは、別の worktree にレビュワーを立てて対象 worktree のパスを読ませている。
  このレビュー用 worktree は作業には使わないので無駄
- レビューは実装したモデルとは別のモデルに頼み、ある程度敵対的にしたい
- 残ると嬉しいのは設計判断と作業手順。大きな機能をタスク分解 (`A -> B + C -> D`) した経緯を
  GitHub Issue の description に書いて新規セッションに参照させると、後から「どうしてこうなったか」を
  追える。この価値は作業の委譲があってもなくても存在する。plan も毎回捨てているが、残せば役に立つ

## 過去の試み: cross-review

このリポジトリの `.claude/cross-review.md` に、Claude と Codex へ並行で実装させた成果物を
相互レビュー・議論させる会議体の取り決めがある。かつて手作業で運用していたが、登場人物が
多くて面倒になり、今は使っていない。当時は今のフロンティア級のモデルがおらず、複数エージェントの
議論で精度を上げることを重視していたが、今は賢いモデルを使えばそこまで頑張らなくても
ある程度の精度が出る。

F48 / F56 の参考になる点:

- 進行役 (Claude) は配管役で、議論内容には一切関与しない。仕事はセッションの resume とターン投入、
  session id の保存、発言の追記、「あなたの番です」の合図だけ。禁止事項に「要約するな」
  「意見を足すな」「表現を変えるな」と並ぶのは、LLM を配管に使うと勝手に喋るため
- 審査員同士は直接やり取りせず、append-only の共有ファイル `discussion.md` に追記して
  各自が読みに行く
- 実装者に渡す `feedback.md` は what と why だけ書き、how・議論のメタ情報・相手実装の話は書かない
- 審査員はわざと実装者の意図や経緯を知らない前提にしている (並行実装の勝敗をつける中立性のため)。
  1 本の実装のレビューに経緯を渡したい F48 / F56 とは、渡すべき文脈が正反対

## 既存ツールの調査メモ (2026-07-29 時点)

- [Warp](https://docs.warp.dev/agent-platform/local-agents/interacting-with-agents/conversation-forking/):
  会話の任意地点から `/fork`。文脈を引き継いで別ペインで独立する。
  `/fork-and-compact` (要約しながら分岐)、`/fork-from` (分岐点を選ぶ) もある。
- Cursor 3.11 (2026-07): Side Chats。`/side` で主スレッドの文脈を継いだ別セッションを立て、
  結果を `@` で元の会話から参照して取り込める。双方向メッセージングではなくプル型。
- Warp も Cursor も worktree は分けない。文脈だけ分岐して作業場所は同じ。
- Zed: 「[Fork with agent…](https://github.com/zed-industries/zed/discussions/58334)」
  (今のスレッドを引き継いで別のエージェントで新スレッド) という要望が立っている。
  エージェントの内部状態は移せないので、ユーザーから見える会話記録を読ませるのが現実解、という結論。
  fork 先を新しい git worktree にする案も別途出ている。
- Codex: [エージェントが自分で worktree を作ると UI が追従しない問題](https://github.com/openai/codex/discussions/16440)。
  `::git-create-worktree{...}` のような構造化された指示でエージェントから UI へ通知する案が出ている。
- handoff 系スキル ([session-handoff](https://github.com/softaworks/agent-toolkit/tree/main/skills/session-handoff) など)
  の共通見解: 会話の全文を渡すと受け手が誤読する。特に「送り手が調べて捨てた行き止まり」が
  受け手には「まだ有効な調査方針」に見える。決定・次の一手・未解決の問いに絞った文書を作る方がよい。
- worktree 並列系のツール (Conductor, Claude Squad, Vibe Kanban, Sculptor など) は
  worktree の分離と diff レビュー UI が中心で、セッション間の文脈引き継ぎはどれも薄い。
- [cmux](https://github.com/manaflow-ai/cmux): Ghostty ベースの macOS ターミナル。
  意図的にオーケストレータにならず「primitive」に徹する方針。
  CLI と socket API でアプリ自体をエージェントから操作できる
  (workspace/tab 作成、pane 分割、キー入力送信、画面の読み取り、内蔵ブラウザ操作)。
  エージェント → アプリの通知は標準の terminal escape sequence (OSC 9/99/777) か
  `cmux notify` CLI + agent hooks。waiting 中の pane に青いリングが付く。
  worktree 連携は外部 CLI (worktrunk) に任せて 1 workspace = 1 worktree。
  再起動時は Claude Code / Codex の resume コマンドを保存しておいてセッションごと復元する。
- [herdr](https://knightli.com/en/2026/07/06/herdr-terminal-agent-multiplexer/): Rust 製 TUI の agent multiplexer。
  local Unix socket API があり、エージェントが workspace 作成・pane 分割・出力の読み取り・
  状態変化の購読をできる (画面スクレイピングではなく購読)。
  エージェントの状態検出は process 名 + 出力パターンのヒューリスティックで、
  hook なしでも blocked / working / done / idle を出す。
  エージェント向けに skill として配布している (`npx skills add ... --skill herdr`)。

### cmux / herdr の fork・review 系ソリューション

- cmux 本体に「Fork Conversation」がある。agent terminal のタブ右クリックから、
  会話を fork して split / tab / workspace のどこに開くか選べる。
  Claude Code / Codex / opencode / Pi に対応。
- cmux のエコシステムに diff レビューがある ([cmux-hub](https://github.com/azu/cmux-hub) や `cmux diff`)。
  diff 上で行を選んでレビューコメントを書き、コメント一式を構造化されたフィードバックとして
  実装エージェントの terminal に直接流し込める。「.md を置いて読ませる」の代替になっている。
- [pi-cmux](https://github.com/javiermolinar/pi-cmux): コーディングエージェント Pi の拡張として、
  cmux の API を使ったワークフローを agent 側に実装している。
  - `/cmcv -c <branch>`: branch worktree を作り、そこに handoff context 付きで Pi を起動する
    (= F48 の作業分岐そのもの)
  - `/cmrv`: split に focused review session を開始する
- 役割分担がはっきりしている: **アプリ (cmux) は fork・split・diff・通知の primitive を提供し、
  worktree 作成 + handoff のワークフローは agent 側の拡張 (pi-cmux) が組む**。
- herdr の "handoff" はサーバ更新時に生きた pane を新サーバへ引き継ぐ話で、会話の fork ではない。
  会話の fork は Pi 側のパッケージ (pi-split-session: 会話を右側の session に fork し、
  clean handoff を main session に import する) がやっている。herdr 本体には fork / review 機能はない。

## 既存スキル・subagent の確認結果 (2026-07-30)

発端で挙がった既存スキルの実物と、Claude Code の subagent の挙動を確認した。

- `/code-review` (Claude Code 組み込み): レビューを実行するのは Claude 系モデルの subagent 群。
  依頼文を組み立てるのは会話を持っている実装セッション自身なので、会話由来の文脈を混ぜる能力は
  あるが、実際どこまで混ざるかは skill の指示次第で保証ではない
- `/codex:review` (codex plugin): local の git state だけを Codex にレビューさせる。
  「native-review only」と明記されていて会話の文脈は渡らない。結果は response として
  実装セッションの会話に verbatim で返り、`--background` + `/codex:status` で
  非同期 + ポーリングも既にやっている。敵対的フレーミングとカスタム観点は
  `/codex:adversarial-review` に分離されている
- `/codex:transfer`: 現在の Claude セッションを resumable な Codex thread に変換する。
  会話は引き継がれるが、会話の続きとして頼む形になる
- Claude Code の subagent: 親が prompt を組んで spawn し、最終レポートが tool result として
  親の会話に返る (関数呼び出しの形)。ユーザーにできるのは transcript を覗くことと全体の中断だけで、
  走行中の subagent に横から口を出す手段はない

## 方向性 (2026-07-30 時点)

ブレストの結果、現時点で合意した方向性。スパイク項目が残っているので確定ではない。

### fork ではなく handoff

fork (会話履歴を複製して未来を 2 つに分岐させる) は採用しない。
fork で作業分担する場合、分岐前に親側で分担を相談してから fork し、fork 直後の 1 通目で
「あなたは B 担当」と役割を指定する運用になるが、それでも:

- 分岐時の取り決め (何をなぜ任せたか) が会話の中にしか残らない。fork したこと自体も成果物に
  残らず、残したい「設計判断・作業手順」を一番残さないやり方
- 子は「役割指定の 1 通」より「親タスクの勢いが詰まった履歴全体」に引っ張られる
  (調査メモの「捨てた行き止まりが有効な調査方針に見える」問題の変種)
- 同じエージェントの内部履歴の複製なので provider を跨げず、モデルを変えた敵対的レビューに
  原理的に使えない。レビュワーを fork で作ると実装者の思い込みごと複製され、自己レビューと同じになる

handoff (新しいセッションに「こういう文脈だからあなたはこれをして」を渡す) を採る。
handoff の内容はテンプレートではなく毎回考える。考えるのは人間ではなくエージェント。

### エージェントが yuru の API で worktree + session を直接作る

エージェントに handoff の文面だけ作らせて人間がコピペで渡すのではなく、親セッションの
エージェントが yuru の API を叩いて新しい task worktree + session を作り、handoff を
初回プロンプトとして入れる。

- 親が子を知っている。親は「どの worktree の誰に何を任せたか」を会話として覚えていて、
  必要になったら API で子の出力を読みに行ける (回収)。ユーザーが子をどう操縦したかも見える
- 親子関係を yuru の metadata には持たない。系譜は親の会話と handoff の中にだけある。
  親が忘れても、残すべき部分は handoff 側に残っている。yuru はただの箱のまま
- 作成経路が yuru を通るので、子は普通の worktree row + session として yuru から見える
  (エージェントが自前で `git worktree add` すると「見えるが操作できない」になる問題が消える)
- 子は subagent ではなく本物のセッションなので、ユーザーは走行中でもターミナルを開いて
  横から話しかけられる (subagent は覗くことと中断しかできない)。レビューの過程に途中で
  突っ込むこともできる

### 分岐は push、レビューは pull

- 分岐: 親が文脈を渡す。handoff を書いて子の初回プロンプトに入れる
- レビュー: 新セッションが文脈を取りに行く。実装者の会話と diff を自分で読む。
  実装視点バイアスの正体は「実装者による取捨選択」なので、渡されるのではなく読みに行けば避けられる。
  ユーザーが実際に求めたことと実装者の解釈を別々に見られる
- 頼み方を工夫すれば、実装者が子としてレビュワーを作る形も成立する
  (実装者は観測を書かず事実だけ渡す: パス、要件の出所、「主張は自分で diff と照合しろ」)
- どちらも必要な primitive は同じ。「worktree + session を作って初回プロンプトを入れる」と
  「セッションを読む」。向きが違うだけで、箱が提供するものは増えない
- レビュー側は F56 ([F56-conversation-context-review.md](F56-conversation-context-review.md)) と重なる
- 親がいないレビュー (ユーザーが直接レビュワーを立てる pull 型) は一旦考えない。
  従来と同じ手間が要りそうな上、親起点のレビューが便利ならそもそも不要になる可能性がある

### セッション間の受け渡しはファイルで

レビュー結果の返しなど、子から親へ成果物を渡す経路は 4 案を比較した。

1. 親が子のセッションログを読む → ノイズが多く、どこを読めばいいか分からない
2. 子が yuru に返し、親が messagebox を読む → yuru が未配達状態を抱えることになる。
   request/response の対応表を箱が持たない方針に反するし、yuru が落ちる可能性もある
3. 子が親の PTY にメッセージを突っ込む → ユーザーの入力と競合する
4. 親がアウトプット先のファイルパスを handoff に含めて頼み、子がそのファイルを書く → **これを採る**

4 の利点:

- 受け渡しの経路に yuru が一切登場しない。状態はディスクにあり、yuru が落ちても残る
- 発端の「/tmp 以下の .md で申し送り」案そのもの。あのとき面倒だったのはファイルではなく
  人間が両側に頼む配管仕事で、それはエージェントが worktree + session を作る方式で消えている
- パスを決めるのはプロンプト層なので、使い捨て (/tmp) か記録として残す (repo 内) かの選択も
  ユーザー層に落ちる。中立性の原則と整合する
- 失敗モード (子の中断、rate limit) は「ファイルが来ない」に退化し、ハングする状態が原理的にない

なお 1 は副経路として残る。生ログ読みはキュレーション自体を監査したいとき (レビューの pull) の
手段で、キュレーション済みの成果物が欲しいとき (結果報告) はファイル、と用途が直交する。

規約はすべて skill に書く内容で、yuru の API はファイルの存在を知らない:

- パスの衝突は `mktemp` で避ける。yuru がパスを確保する API は作らない
- 書きかけと完成の区別: 一時ファイルに書いて最後に `mv` する (rename はアトミック)
- 完成待ちは親がファイルをポーリングする。Claude Code なら background の bash
  (`until [ -f <path> ]; do sleep 5; done`) でファイル出現時に親が自動で再開し、ターンも塞がない。
  provider によってはできないかもしれず、その場合は人間が親をつつくフォールバックに戻るだけ。
  yuru に通知の primitive は足さない

ファイル + ポーリングは、cross-review の「`discussion.md` への追記 + done の合図」と同じ形。
発端の「セッション同士を会話させるプロトコル」は、yuru の機能なしにこの種の規約だけで実装できる。

### API + 組み込み skill 1 つ

- エージェントへの提供は MCP ではなく API + skill (cmux / herdr と同じ形)
- 組み込み skill は `/yuru` の 1 つだけ。中身は API の使い方のみで、ユースケースは書かない
- 分岐・レビューといった具体用途は、ユーザーが自分のカスタム skill / command として拡張する。
  カスタム skill は人間がスラッシュコマンドとして打つこともでき、補完も効く
- yuru はオーケストレーション機能を持たない。ワークフローは skill 層 (エージェント側) が組む
  (cmux の「意図的にオーケストレータにならない、primitive に徹する」と同じ立場)
- エコシステムは用意しない

### API のプロトコル

機能のエンドポイントより下の、通信方式と認証のレイヤー。

- エージェントから見える面は CLI。既存の `yuru` CLI に乗せ、skill は CLI の使い方を説明する。
  公開契約が CLI の入出力だけになり、ワイヤプロトコルは完全に内部実装になる。
  skill は起動時に常に上書きされるので、skill と CLI とアプリが常に同世代
  (cmux / herdr も CLI・skill を面にして裏を socket にする構成)
- 通信は Unix domain socket。Electron main に Node の `net` サーバを立てる。依存ゼロ。
  localhost TCP と違ってポート衝突がなく (F33 の複数起動でポートの調停をしたくない)、
  認証がファイルパーミッションで済む
- socket のパスは、yuru が PTY を起動するときに環境変数で注入する。yuru はエージェントの走る
  PTY を自分で起動しているので、well-known path の発見問題がない。複数インスタンスも
  各 PTY が自分の親インスタンスの socket を知る形で自然に解決する。
  yuru の外の素のシェルには env がないので CLI は繋がらない (正しい挙動)
- 認証は作らない。socket を 0600 にすれば同一ユーザーのプロセスしか繋げない。
  同一ユーザーのプロセスは API がなくても `git worktree add` や agent の起動を直接できるので、
  API は呼び出し元がもともと持っている権限しか行使しない。トークンを足しても守るものがない

### 中立性の原則

「レビューとはこういうものだ」を yuru が定義すると、作者のドメイン観が焼き込まれて
ただの箱ではなくなる。意見は skill の文面以外からも漏れるので、次の 3 箇所すべてで中立を保つ。

- API の形: `readOnly` フラグのような用途を前提にした引数を持たせない。primitive に留める
- 命名: `dispatch` のような用途の名前を使わない。組み込み skill 名は `yuru`
- ガイド: handoff の書き方 (「決定・次の一手を書け」等) を skill に入れない。モデルの判断に任せる

ドメイン観をユーザー層に置けば、古くなったときに使用者側で捨てられる。
cross-review はユーザー層 (`.claude/cross-review.md`) にあったから、モデルが賢くなった時点で
機能削除なしに手放せた。

### skill の配置

- skill は `~/.yuru/skills` に置く
- 組み込みの `/yuru` は yuru 起動時にそこへコピーし、常に最新で上書きする。
  skill がアプリと同梱で出荷されるので、skill と API のバージョンがずれない
- `yuru` という名前は予約。組み込みを直接編集しても上書きで消える。
  ユーザーのカスタム skill は別名で同じ場所に追加する

### スパイク項目

- provider に `~/.yuru/skills` を読ませる経路。候補と現時点の所感:
  - (a) 起動時に追加ディレクトリをフラグや環境変数で指定する。yuru は PTY を自分で起動するので
    差し込める立場にあるが、provider 側にその口があるかはまちまち (kimi は怪しい)
  - (b) 各 provider のネイティブな置き場 (`~/.claude/skills/` 等) に symlink かコピーで実体化する。
    provider の柔軟性がゼロでも動くが、ユーザーのグローバル設定に手を突っ込む。掃除も必要
  - (c) 起動時プロンプト (`--append-system-prompt` 等) で「読め」と指示する。
    skill の仕組みに乗らないので、skill としてコンテキストに積まれるか謎。補完も効かない
  - (d) リポジトリ内 (`.claude/skills/` 等の project 層)。provider のサポートは最も確実だが、
    repo が汚れる (tracked だとチームに漏れ、untracked だと git status のノイズ)、
    worktree ごとに実体化が要る、repo 間で分散する
- `/yuru` というスラッシュ起動の形式が provider ごとに別物
  (Claude の skill、Codex のカスタムプロンプト、kimi は不明)。どこまで揃えられるか。
  自然言語で「yuru で分岐して」はどの provider でも成立するはずなので、
  スラッシュ補完は provider ごとのベストエフォートでよい
- エージェント側の sandbox / permission モデル。provider によっては Bash が seatbelt 等で
  包まれていて、socket 接続がブロックされたり許可プロンプトが出たりする。
  `yuru` コマンドの allowlist 登録で済むかを含めて確認する

### 未決

- API の具体的な形 (何の primitive をどう露出するか)。
  特にレビュワーの居場所: spawn が必ず新 worktree を作る形だと「レビュー用 worktree は無駄」が
  残る。既存 worktree への 2 つ目の session は「1 task worktree に最大 1 primary session」との
  関係を決める必要がある (architecture.md)
- handoff を初回プロンプトに直接入れるだけにするか、ファイルとしても残すか。
  「設計判断・作業手順が後から追える」という要望をどこで満たすかに関わる。
  受け渡しがファイルに揃ったので、残す場合は置き場所の選び方だけの問題になる
- socket パスと合わせて、PTY ごとに自己識別 (session id 等) の環境変数も注入するか。
  CLI が呼び出し元の worktree / session を宣言なしで特定できるようになるが、
  cwd からも導出できるので YAGNI の余地あり
