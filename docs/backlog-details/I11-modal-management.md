# I11 Modal Management

## Goal

複数のモーダル (RepoPicker / BranchNameInput / FileSearch / 今後増えるもの) と、グローバルショートカット (`Cmd+P` など) を、場当たり対応せずに破綻なく共存させるための設計を決める。

## Why now

F14 (ファイル検索) で `Cmd+P` を入れた際、Codex review で以下が指摘された。

> RepoPicker や BranchNameInput が開いている時に window レベルの keydown リスナーが `isFileSearchOpen` をトグルしてしまい、ファイル検索が他のモーダルの背後に開き、モーダルを閉じた後に突然現れる。

症状としては小さいが、根本原因は「いま開いているモーダルが何か」を一箇所で把握する仕組みが無く、state が App と Workspace に分散していること。
個別に回避コードを入れても、モーダルやショートカットが増えるたびに同じ種類のバグが再発する恐れがあるので、設計として落とし所を決めたい。

## Observations

- 現状のモーダル:
  - `RepoPicker` (App.tsx)
  - `BranchNameInput` (App.tsx)
  - `FileSearch` (Workspace.tsx)
- z-index は全て 100、同じ重なり順
- 「同時に 1 つしか開かない」という暗黙のルールが、state の構造では保証されていない
- `Cmd+P` の listener は Workspace 内の window keydown に直接ついている
- Esc や click-outside の扱いもモーダルごとにバラバラ (FileSearch は input の onKeyDown、RepoPicker は overlay click、BranchNameInput は ...)

## Questions

- 「同時に 1 つしか開かない」を構造で保証すべきか (enum な activeModal にする)、それとも重ね表示もありうると考えるか
- ショートカットの排他制御を一箇所にまとめる仕組みが必要か
- preview 状態 (`previewSelection` / `diffDocument` / `isLoadingDiff` etc.) の居場所は Workspace のままでよいか、App に上げるか
- Modal 内で発火するアクションが外の state を触る必要がある時 (例: FileSearch → setPreviewSelection)、state の置き場所と callback の経路をどう設計するか

## Possible directions

### 案 1: App に `activeModal` を集約

- App が `activeModal: null | "repo-picker" | "branch-name" | "file-search"` を保持
- 全モーダルの描画を App に一本化 (Workspace からは FileSearch を外す)
- Cmd+P のハンドラも App 側に置き、`activeModal !== null && activeModal !== "file-search"` なら無視
- メリット: 「同時に 1 つしか開かない」が構造で保証される
- デメリット: FileSearch が `sessionId` と `onSelectFile` を App から受け取る必要があり、現在 Workspace に閉じている preview 関連 state を App に上げる必要がある

### 案 2: Modal stack Context

- `ModalStackProvider` で現在開いているモーダル ID をスタック管理
- モーダルは mount 時に register、unmount で pop
- ショートカットは `useIsTopmost(scope)` で判定
- メリット: モーダル追加で既存コードを触らない、階層 (モーダルの中からさらにモーダル) も自然
- デメリット: 現状 3 モーダルに対してはオーバーエンジニアリング気味

### 案 3: 場当たり対応 (ボツ)

- Workspace の Cmd+P 内で `document.activeElement` が input/textarea か、などで弾く
- メリット: 変更が狭い
- デメリット: 原則的でない。モーダル追加ごとに全ショートカットを修正することになり、同種のバグが再発する。本件でボツにした理由そのもの

## Current lean

**案 1 が落としどころ** になりそう。

- 状態の集約として自然 (モーダル = App レベルの排他的 UI 状態)
- preview 状態を App に上げるのは副産物として発生するが、preview もセッション横断の UI 状態なので App にあっても不自然ではない
- 将来モーダルが増えて階層が必要になった時点で案 2 に拡張する余地は残る

ただし案 1 も小さくない改修 (Workspace の preview 関連 state を App に持ち上げる) なので、このタスクは「モーダル state の集約 + preview state の居場所見直し」という 1 つのリファクタリングとして扱う。

## Out of scope (for now)

- モーダルの中にモーダル (階層) のサポート
- キーボードショートカットを登録・解除する汎用レジストリ (案 2 の拡張時に検討)
- モーダル共通のラッパコンポーネント化 (overlay, focus trap 等の統一)。必要になったら追加で検討
