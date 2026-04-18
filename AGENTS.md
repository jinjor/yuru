# Project Guidelines

## Development

After editing files on macOS, rebuild and restart the app:

```sh
npm run build
npm run app:restart
```

This is for checking behavior changes. Documentation-only edits do not need a rebuild or restart.

## Docs

- Product backlog: `docs/backlog.md`
- Architecture notes: `docs/architecture.md`
- Coding guidelines: `docs/coding-guidelines.md`

## Design

- シンプルは正義、複雑さは悪。
  - 可能な限り複雑さを導入せず、シンプルな方法で解決すること。
  - コードが複雑になりそうな時、まず根本原因を改善できないかを考えること。
  - 将来の可能性を考えて余計なコードを書かないこと（YAGNI）。
  - 限りなく可能性の低い状況に対応するために大量のコードを書かないこと。
  - 余計なフォールバック処理を書いてデバッグを困難にしないこと。

- 状態の居場所を考えること。
  - single source of truth を重視すること。
  - ある状態変化が別の状態変化を生む時、後者はキャッシュであり、不要なら削除すべきである。

- 嫌なコードの臭いを感じとり、設計の改善で解決できないかを考えること。
  - useRef の多用
  - useEffect の多用
  - set しか使っていない useState
  - requestAnimationFrame の使用
  - deps list の一部をあえて抜いている
  - 抽象度の高いレイヤーに具体的すぎるロジックが書かれている

- コンポーネントを適切な粒度で切り分けること。
  - 1つのコンポーネントに全く性質の違う複数の状態を同居させないこと。
  - 1つのコンポーネントでしか利用しないロジックは、そのコンポーネントに入れるか、ディレクトリ化してまとめること。

- ライブラリの挙動を勝手に推測せずに調べること。
  - 「こういう挙動をする可能性があるから」と防御的なコードを書かずに、ドキュメント・コード・実際の挙動を調べること。

- 既存のコード・設計を疑うこと。
  - 機能を実装しにくい時、既存のコード・設計に問題がある場合があるので、その場合は何が問題かを指摘すること。
  - ただし、既存の設計を大幅に変えるときは事前に相談すること。
