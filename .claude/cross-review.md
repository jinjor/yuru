# Cross-Review Workflow

このファイルは、Claude と Codex に並行で実装させた成果物を相互レビュー・議論を通じて評価するワークフローの取り決めです。各エージェントは起動時にこのファイルを読み、自分の役割と全体の流れを理解してから動作します。

## 概要

目的: ある機能を Claude と Codex が並行で実装した際、それぞれが両実装をレビュー・比較し、議論を通じて勝者の決定と修正点の抽出を行う。

参加者は 4 者:

- **議長** (人間): 議論の主体
- **進行役** (Claude): 配管役
- **Claude 審査員** (Claude、永続セッション): レビューと議論参加
- **Codex 審査員** (Codex、永続セッション): レビューと議論参加

## 役割

### 議長

- 議論の主体。質問・反論・論点切替・最終判断・まとめ承認を行う
- 進行役を通じて発言する。`discussion.md` には直接書き込まない

### 進行役

- 議事を回す配管。議論内容には**一切関与しない**
- 仕事:
  - 議長の発言を `<turn speaker="Human">` として `discussion.md` に追記する
  - 指示された審査員のセッションを resume し、ターン投入する
  - 議長のフィードバック作成指示を受けたら、`feedback.md` をドラフトする。
- 禁止事項:
  - 議論内容への意見・要約・収束判断・自発的提案
  - `feedback.md` に進行役自身の新しい解釈や意見を加えない（内容は審査員のレビューと議長の判断のみから構成）

### 審査員 (Claude / Codex)

- 両実装（Claude 実装と Codex 実装）をレビューし、比較する
- 自分の発言は `<turn speaker="<self>">` として `discussion.md` の末尾に追記する

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

### Phase C: クロージング

1. 議長がフィードバック作成を指示
2. 進行役が `feedback.md` をドラフト:
   - 本体は審査員のレビュー内容（`claude-review.md` / `codex-review.md` / `discussion.md` の発言）から取る
   - 議長の採否判断（「これ採用」「これはダメ」など）でフィルタリング・取捨選択する
   - 進行役自身の新規解釈・意見は加えない
3. 議長が確認・編集
4. 議長が `feedback.md` を勝者の実装者セッションに渡して次イテレーションへ（このワークフローの範囲外）

## 成果物

`reviews/` 直下にフラットに配置（gitignored）:

- `claude-review.md`: Claude 審査員による両実装のレビューと比較
- `codex-review.md`: Codex 審査員による両実装のレビューと比較
- `discussion.md`: 4 者共有の議事録
- `feedback.md`: 議論まとめ、勝者向け
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

### `feedback.md`

~~~
<feedback winner="Codex">
<accepted-designs>
- エラーハンドリングは try-catch で局所的に （論点 #1 で codex 案採用）
</accepted-designs>

<fixes>
- ファイル X の関数 Y: <修正内容> （論点 #3 で claude 指摘、codex 同意）
</fixes>

<rationale-references>
論点 #1, #3
</rationale-references>
</feedback>
~~~

進行役は審査員のレビュー（`claude-review.md` / `codex-review.md` / `discussion.md` の発言）から内容を取り、議長の判断（採用・却下）でフィルタして構造化する。進行役自身の新規解釈・意見追加は禁止。

## テンプレ文面

進行役が再利用する定型プロンプト。

### 審査員（初回レビュー）

> あなたは `.claude/cross-review.md` に定義された会議体の **{Claude|Codex} 審査員** です。まず `.claude/cross-review.md` を読んで全体の取り決めを理解してください。その後、両実装（Claude 実装: `<claude-impl-path>`, Codex 実装: `<codex-impl-path>`）をレビューし比較した結果を `reviews/{claude|codex}-review.md` に出力してください。

### 審査員（議論ターン、resume 後）

> あなたの番です。`reviews/discussion.md` の最新状態を読み、応答を `<turn speaker="<self>" topic="<current-topic-id>">` で末尾に追記してください。完了したら `done` とだけ返してください。
