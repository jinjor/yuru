# Cross-Review Workflow

このファイルは、Claude と Codex に並行で実装させた成果物を相互レビュー・議論を通じて評価するワークフローの取り決めです。各エージェントは起動時にこのファイルを読み、自分の役割と全体の流れを理解してから動作します。

## 概要

目的: ある機能を Claude と Codex が並行で実装した際、それぞれが両実装をレビュー・比較し、議論を通じて勝者の決定と修正点の抽出を行う。

参加者は 4 者:

- **議長** (人間): 議論の主体
- **進行役** (Claude): 配管役
- **Claude 審査員** (Claude、永続セッション): レビューと議論参加
- **Codex 審査員** (Codex、永続セッション): レビューと議論参加

審査員は実装者とは別エージェント。同じ種類のエージェント（Claude / Codex）でもセッションは独立しており、実装者の意図や経緯は知らない前提でレビュー・議論する。

## 役割

### 議長

- 議論の主体。質問・反論・論点切替・最終判断・まとめ承認を行う
- 進行役を通じて発言する。`discussion.md` には直接書き込まない

### 進行役

- 議事を回す配管。議論内容には**一切関与しない**
- 仕事:
  - 議長の発言を `<turn speaker="Human">` として `discussion.md` に追記する
  - 指示された審査員のセッションを resume し、ターン投入する
  - 議長のフィードバック作成指示を受けたら、次の feedback ファイルをドラフトする
  - 議長の修正後レビュー指示を受けたら、審査員に最新の feedback ファイルと修正済み実装を確認させる
- 禁止事項:
  - 議論内容への意見・要約・収束判断・自発的提案
  - 議長の発言を `discussion.md` に追記するときに表現を変えること
  - 議長の発言内容を直接審査員に伝えること（必ず `discussion.md` を通じてやり取りすること）
  - feedback ファイルに進行役自身の新しい解釈や意見を加えない（内容は審査員のレビューと議長の判断のみから構成）

### 審査員 (Claude / Codex)

- 両実装（Claude 実装と Codex 実装）をレビューし、比較する
- 自分の発言は `<turn speaker="<self>">` として `discussion.md` の末尾に追記する
- 自分と同じ種類のエージェントが書いた実装に肩入れしない。Claude 審査員は Claude 実装を、Codex 審査員は Codex 実装を、無意識にひいきしないよう中立を保つ

## コミュニケーションの取り決め

`discussion.md` を 4 者共通の議事録とする。

- **書き込み**: 進行役と審査員のみ。議長の発言は進行役が代筆する
- **読み取り**: 全員。審査員は呼ばれた時に最新状態を読みに来る
- 進行役は審査員間の発言を「翻訳」しない。各審査員は `discussion.md` を自分で読んで相手の発言を取得する
- 進行役と審査員のやり取りは「あなたの番です」「done」のシグナルのみ

## ライフサイクル

### Phase A: レビュー開始

1. 議長が新しい Claude セッションで `/cross-review` を実行（= 進行役セッション開始）
2. 議長がレビュー開始の意図を進行役に伝える
3. 進行役:
   - 議長の指示から Claude 実装と Codex 実装のパスを特定する（曖昧なら確認）
   - 議長の指示から「何の機能のレビューか」を把握し、審査員起動時に伝える
   - `rm -rf reviews/` を実行
   - `reviews/` を作成、両実装のパスを `sessions.json` に記録
   - Claude 審査員を起動: `claude -p` で初回レビュー指示を投入し、出力された session-id を `sessions.json` に保存
   - Codex 審査員を起動: `codex exec --json -s workspace-write` で初回レビュー指示を投入し、stdout の `{"type":"thread.started","thread_id":"..."}` から `thread_id` を取得して `sessions.json` の `codex_reviewer_session_id` に保存
   - 両者の review.md 出力を待つ

### Phase B: 議論

ループ:

- 議長が自然言語で発言（「Claude がこう言ってるけど Codex どう？」など）
- 進行役:
  - 議長の発言を `<turn speaker="Human">` として `discussion.md` に追記
  - 議長の指示に基づき、対象審査員のセッションを resume してターン投入
    - Codex 審査員の場合は `codex exec --json -s workspace-write resume <codex_reviewer_session_id> "<議論ターン指示>"` を使う
  - 審査員から `done` を受けたら議長に通知（応答内容は `discussion.md` で確認）
- 議長は次の指示を出す（同じ審査員にもう一度、別の審査員に振る、論点切替、議論終了など）

ルール:

- 議長が指名なしで質問した場合、両者に投げる質問として扱う。議長から特別な指示がない限り両審査員に振り、回答が終わったら次の指示を仰ぐ
- 回答順は両審査員間で偏らないように、進行役が交互に切り替えて調整する（前回 Claude が先なら今回は Codex を先、など）。議長が順番を指定したらそれに従う

### Phase C: フィードバック作成

1. 議長がフィードバック作成を指示
2. 進行役が `feedback.md` をドラフト（フォーマット詳細は後述）
3. 議長が確認・編集（必要に応じて審査員に伝わるか確認させる）
4. 議長が `feedback.md` を勝者の実装者セッションに渡して修正を依頼する

### Phase D: 修正後レビュー

最新の feedback ファイルを受けて実装者が修正した後、その修正済み実装が feedback と議論の意図を満たしているかを再レビューする。

ループ:

- 議長が修正済み実装のレビュー開始を指示する
- 進行役:
  - 議長の発言を `<turn speaker="Human">` として `discussion.md` に原文のまま追記する
  - 指示された審査員のセッションを resume し、最新の feedback ファイルと `sessions.json` の勝者実装パスを確認させる
  - 審査員から `done` を受けたら議長に通知する
- 審査員:
  - 最新の feedback ファイルの各項目が、背景にある議論の意図も含めて修正済み実装で満たされているかを確認する
  - 未対応・回帰・新たに修正が必要な点だけを `discussion.md` に追記する
  - 問題がなければ、その旨だけを `discussion.md` に追記する
- 議長:
  - 追加修正が必要なら、進行役に次の feedback ファイルの作成を指示し、実装者セッションへ渡す
  - 修正後、再び Phase D を実行する

完了条件:

- 指示された審査員が未対応・回帰・追加修正なしと判断し、議長が終了を宣言する

## 成果物

`reviews/` 直下にフラットに配置（gitignored）:

- `claude-review.md`: Claude 審査員による両実装のレビューと比較
- `codex-review.md`: Codex 審査員による両実装のレビューと比較
- `discussion.md`: 4 者共有の議事録
- `feedback.md`: 初回の議論まとめ、勝者向け
- `feedback-2.md`, `feedback-3.md`, ...: Phase D の修正後レビューで残課題が出た場合に作る追加 feedback。過去の feedback ファイルは上書きしない
- `sessions.json`: セッション ID とパス情報（例: `{"claude_reviewer_session_id": "...", "codex_reviewer_session_id": "...", "claude_impl_path": "...", "codex_impl_path": "..."}`）

サイクル開始時は `rm -rf reviews/` で丸ごと削除して作り直す。

## フォーマット仕様

### `discussion.md`

XML タグで構造化する。markdown 衝突を避けるため、構造マーカーは XML、内容部分は markdown 自由。

例（外側のフェンスは説明のための表記）:

~~~
<topic id="1" title="エラーハンドリングの方針">
</topic>

<turn speaker="Human" topic="1">
claude がこう言ってるけど codex どう？
</turn>

<turn speaker="Codex" topic="1">
ここはこう思う。コードを見ると...

```js
function foo() { ... }
```

理由は X だから。
</turn>

<turn speaker="Claude" topic="1">
いやいや、それだと Y のケースが...
</turn>

<topic id="2" title="次の論点">
</topic>
~~~

ルール:

- `<topic>` で論点を区切る。`id` は連番、`title` は議長の宣言から進行役が決める
- `<turn speaker="...">` の値は `Human` / `Claude` / `Codex` のいずれか
- `topic` 属性で所属する論点を示す
- 内容内に `</turn>` をリテラルで書かない（コードブロック内含めて禁止）
- 既存の `<turn>` を編集せず、必ず末尾に追記する
- 読み取り時は最新の `<topic>` 配下の `<turn>` 群を参照すれば直近の文脈が分かる

### feedback files

普通の markdown で書く。XML タグは使わない。

PR にコードレビューを書く時と同じ様式で、実装者向けの修正点リストとして構成する:

- 初回は `feedback.md` に書く
- 2 回目以降は `feedback-2.md`, `feedback-3.md`, ... のように round ごとの別ファイルを作る
- 「最新の feedback ファイル」は、存在する中で一番大きい round 番号のものを指す。番号付きファイルがなければ `feedback.md` を指す
- 既存の feedback ファイルは、議長の確認後は原則として上書きしない
- 各 feedback ファイルには、その round で実装者に渡す未対応・追加修正点だけを書く
- 修正してほしい点（what）と理由（why）だけ書く。細かい実装方法（how）は書かない
- 裏でどんな議論が行われたか、誰がどの判断をしたか、論点番号などのメタ情報は一切書かない
- 相手側の実装の話は基本的に一切しない。知っているから言いたくなるが、伝えられる側にとってはただのノイズ
  - 例外: 相手側の実装に参考にしてほしい部分がある場合のみ、コードのパスなどを示してよい
- 議論で出ていない話題（議長が触れていないドキュメント更新など）を進行役の判断で追加しない
- 進行役自身の新規解釈・意見追加は禁止。本体は審査員のレビュー（`claude-review.md` / `codex-review.md` / `discussion.md` の発言）から取り、議長の採否判断でフィルタする

## テンプレ文面

進行役が再利用する定型プロンプト。

### 審査員（初回レビュー）

> あなたは `.claude/cross-review.md` に定義された会議体の **{Claude|Codex} 審査員** です。まず `.claude/cross-review.md` を読んで全体の取り決めを理解してください。その後、両実装（Claude 実装: `<claude-impl-path>`, Codex 実装: `<codex-impl-path>`）をレビューし比較した結果を `reviews/{claude|codex}-review.md` に出力してください。

### 審査員（議論ターン、resume 後）

> あなたの番です。`reviews/discussion.md` の最新状態を読み、応答を `<turn speaker="<self>" topic="<current-topic-id>">` で末尾に追記してください。完了したら `done` とだけ返してください。

### 審査員（修正後レビュー、resume 後）

> あなたの番です。`reviews/discussion.md` の最新状態、最新の feedback ファイル、`reviews/sessions.json` の勝者実装パスを読み、修正済み実装が feedback と議論の意図を満たしているか確認してください。未対応・回帰・追加修正が必要な点だけを、応答として `<turn speaker="<self>" topic="<current-topic-id>">` で `reviews/discussion.md` の末尾に追記してください。問題がなければその旨だけを追記してください。完了したら `done` とだけ返してください。
