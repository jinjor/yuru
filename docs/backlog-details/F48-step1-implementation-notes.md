# F48 Step 1 実装に関する問答

Last updated: 2026-08-01

## 質問

ところで今回の実装は既存の実装から独立性が高いもの？
実装しにくかったところとか、負債になりうるところとかがあったら教えて欲しい。

## 回答

結論として、Step 1 の独立性はかなり高いです。既存実装への接続点は限定されています。

- `src/main/api-server.ts` は Node 標準機能だけで完結
- 既存の起動・停止処理には server の開始・終了だけを追加
- terminal 周りは環境変数の生成箇所だけを変更
- renderer、metadata、Git、provider adapter には触れていない

実装上いちばん手間だったのは、アーキテクチャより実行環境です。Codex の sandbox が Unix socket の listen/connect を拒否するため、socket を使うテストだけ sandbox 外で実行する必要があります。これはプロダクトコードの負債ではありませんが、今後 `npm test` を Codex から実行するときの注意点にはなります。

- CLI と server が wire protocol の構造を別々に解釈しています。今は小さいため問題ありませんが、Step 2・3でコマンドやレスポンスが増えると仕様ずれのリスクが上がります。ただし CLI を依存ゼロにする設計とのトレードオフなので、現時点で共通化する必要はありません。

- `scripts/yuru-cli.mjs` は既存のインストール・更新機能と socket API client が同居しています。数コマンドなら十分ですが、引数解析が増えた段階で socket command 部分を分けた方が読みやすくなる可能性があります。

- task worktree かどうかの判定が `src/main/service.ts` の2か所にあります。まだ単純な比較なので共通化するほどではありませんが、Step 3などで3か所以上に増えるなら helper 化を検討できます。

- パッケージ版の CLI path は、`app.getAppPath()/scripts/yuru-cli.mjs` と package script のコピー先が一致するという暗黙の契約です。現在の `asar: false` 構成では正しく動きますが、将来 packaging 構成を変える際には両方を一緒に直す必要があります。

また、API server の起動に失敗しても本体を起動する方針にしたため、その場合も terminal には接続不能な `YURU_API_SOCKET` が入ります。現在はUIに警告が残り、CLIも接続エラーを明示するので矛盾した挙動ではありません。ただし、将来 server の再起動や復旧を提供するなら、APIの稼働状態を動的に管理する設計が必要になります。

総じて、現時点で直すべき構造的負債はありません。Step 2・3で CLI の分岐と protocol の型が実際に増えた時点が、分割や共通化を判断する適切なタイミングです。
