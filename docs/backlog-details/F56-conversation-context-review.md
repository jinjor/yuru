# F56 別の agent に会話コンテキスト付きでレビューを依頼しやすくする

Last updated: 2026-07-28

## 背景

ある agent と会話しながら worktree の変更を実装したあと、別の agent にレビューを依頼しても、
Git の差分だけでは要件や設計判断が伝わらない。レビュー側がコードから意図を推測することになり、
会話ではすでに確認・合意していた内容とずれた指摘が返ることがある。

provider の保存済み session には会話が残っているが、現在の Yuru は一覧表示に必要な
最後のメッセージや worktree の手掛かりを読むだけで、別 session のレビューへ会話を渡す導線を
持っていない。ユーザーが保存先を探し、ログの読み方までレビュー側へ指示すれば参照できるが、
日常的なレビュー手順としては手間が大きい。

## 目的

同じ worktree を別の agent にレビューさせる際、実装を進めた session の会話も簡単に参照できる
ようにする。レビュー側が、少なくとも次の文脈を把握してから差分を確認できることを目指す。

- ユーザーが求めていたこと
- 調査で確認できた事実
- 会話中に決めた設計とトレードオフ
- 意図的に対象外としたこと

Codex で実装した変更を Claude でレビューする場合など、source と reviewer の provider が
異なるケースを含む。

## 期待する体験

- ユーザーが provider の session ID や保存ログの場所を手作業で探さなくてよい
- レビュー依頼のたびに会話を手作業で要約・コピーしなくてよい
- レビュー側は会話を資料として読み、その内容と実際の差分を照合できる
- 通常の Git 差分レビューと同じ程度の手軽さで繰り返し使える

## 現在わかっていること

- Yuru は primary session の provider と provider session ID を把握している
- Claude、Codex、Kimi はそれぞれ形式は異なるが、会話を provider store に保存している
- Yuru の provider adapter は保存済み session をすでに読んでいるが、共通形式の会話全文は
  提供していない
- 現在の Yuru は 1 worktree に最大 1 つの primary session を持つため、レビュー session を
  Yuru から直接起動する場合は既存の session lifecycle との関係を決める必要がある

## 実装前に決めること

現時点では詳細設計を固定しない。実装時に少なくとも次を比較する。

- レビュー用プロンプトをコピーする導線と、reviewer session まで起動する導線のどちらにするか
- provider の生ログを参照させるか、ユーザーと agent の会話を共通形式へ抽出するか
- 会話全文を渡すか、対象範囲を選ぶか、要約を併用するか
- system / developer message、tool call、tool output をどこまでレビュー資料に含めるか
- 長い会話のサイズ、機密情報、一時データの保存場所と寿命をどう扱うか
- reviewer session を primary session や既存の active session とどう共存させるか

## 対象外

- agent 同士が自律的にタスクを分担・進行する汎用 orchestration
- レビュー結果の自動採用や、自動でのコード修正
- provider store 自体を Yuru の独自形式へ移行すること
