# F71 Worktree Bookmarks

Last updated: 2026-08-23

`F71` の設計メモ。

## 背景・課題

- 会話の中で「この issue」「この PR 待ち」のようなリンクが発生するが、ターミナルのスクロールバックに流れてしまい、後から探すのに苦労する
- worktree に紐付けて、関連する資料や画面へ素早くアクセスできるようにしたい
- セッションではなく worktree に紐付けるのは、同じ worktree で複数のセッションを跨いで使いたいから

## 要件

- ブックマーク（URL + 名前）は worktree 単位で保持し、セッションを跨いで残る
- UI は右ペインの Search の右隣のタブ。タブ内にリンク集が縦に並ぶ
- 追加・削除の体験のバリエーション:
  1. 手動 UI（追加・更新・削除・並び替え）
  2. ターミナル上からドラッグやコンテキストメニューで追加
  3. スキル経由でエージェントが API を使って登録
     - 3-1. 「URL を XXX という名前でブックマークして」と明示的に頼む
     - 3-2. 「その issue ブックマークしといて」と頼む（名前はエージェントが決める）
     - 3-3. 何も言わなくてもエージェントが勝手に追加・削除する（理想）
  4. ターミナルに登場したリンクを無条件で追加していく
- 1 は面倒なのでメインにはしたくない

## 決まったこと（2026-08-18 の会話）

- **title は必須**。一番多い対象は GitHub の Issue / PR で、番号だけでは何か分からないため
- **PR もブックマーク対象**。エージェントが worktree 内で branch を切り替えながら作業すると特に PR を見失う。現行の PR 表示は worktree の**現在の branch** に紐づく PR をポーリングで追う仕組み（`pull-request-monitor.ts` が `pullRequests.get(worktree.branch)` で解決）なので、branch を切り替えると前の PR は表示から消える。ブックマークは branch に依存せず残るので、これを補完できる
- **`source` 属性は持たない**。エージェントに勝手に消されるのは怖いので、まずは削除 API 自体も作らない
- **並び替えは無し**（追加順固定）
- **体験 4 を先に試す**。体験 4 で十分便利なら体験 3 は要らなくなり、skill も API も無駄になるため。API/スキルは体験 4 の有用性を確認してから判断する
- **title が取れない場合は URL を仮 title として登録する**。失敗したものの再解決はしない
- **localhost は除外しない**。ローカルに建てたサーバーでのデバッグ画面もブックマークしたいため
- **URL の正規化はしない**。クエリ文字列や `#` 違いは別ブックマークとして扱う（重複判定は URL 文字列の完全一致）
- **GitHub の title 解決はページ種別ごとの API に分けない**。URL パターンから owner/repo/番号を抽出し、`gh api repos/{owner}/{repo}/issues/{n}` を 1 本に統一する（REST の issues エンドポイントは PR も返すことを実機確認済み）。issue / PR 以外（discussion / blob / commit 等）は汎用 fetch に任せる

## 実装時の変更（2026-08-22 の会話）

- ターミナル出力を無条件で拾う方式は、エージェントのツール出力や調査ログまで混ざるため採用しない。稼働中セッションの user / assistant メッセージ本文に新しく現れた URL だけを追加する
- user にはユーザー自身が貼った URL を含め、プロジェクト指示・環境情報・ローカルコマンド出力など provider が内部的に user role で記録するものは除外する
- 既存セッションを再開するときは過去ログを走査せず、再開後に追記されたメッセージから取り込む
- Bookmark は URL 自体で一意に識別でき、追加順は配列順で決まるため、`id` と `createdAt` は持たない

## 実装者からの申し送り（2026-08-23）

- 上記の「過去ログを走査せず」は、過去の message を bookmark 取得側へ再生しないという意味。preview の構築と reader の位置合わせでは過去ログを読む場合がある。再開時は listener の登録前に共有 reader を現在位置まで読み、以後の追記だけを通知する。新規 session は `includeExistingMessages: true` で、session ID の判明前を含め watch 登録時点ですでに保存されている会話も対象にする。過去分の再生は共有 reader を巻き戻さず、使い捨ての reader で先頭から読んで登録した listener にだけ渡す
- `watchSessionMessages` は独立した filesystem watcher や timer を作らず、message listener を登録する API。ログの増分読み取りは 3 provider 共有の `SessionLogWatcher` (`src/main/agents/session-log-watcher.ts`) が物理ファイルごとに 1 つの reader で担い、1 回の read batch は登録中の全 listener に通知する (同じ session を複数の terminal runtime が watch しても listener は後勝ちにならない)。Claude / Codex は既存の session monitor による preview の増分読み取り結果を bookmark にも通知する。Kimi は preview を従来どおり `state.json` の `lastPrompt` / `title` から読み、同じ monitor tick で bookmark 用の `wire.jsonl` の増分も確認する。bookmark 専用の polling と同一ファイルの二重読みは増やしていない (過去分の再生時を除く)。waiting が続き activity も変わらない間は、session monitor の timer は動いていてもログファイルは読まない
- provider adapter はログの record を user / assistant の会話へ変換する。Claude / Codex は同じ変換結果から assistant の最新本文を preview に使い、user / assistant 両方の本文を bookmark 取得側へ渡す。Kimi の変換結果は bookmark だけに使う。tool result、system/meta、Yuru が注入した worktree context などの除外は provider adapter の責務。設計中の「フィルタは入れず」は localhost など URL の種類を除外しないという意味であり、message の出所はフィルタする
- Claude / Codex の会話ログ、または Kimi の `wire.jsonl` の置換・truncate を検出した場合、その batch は bookmark 取得側へ通知しない。Claude / Codex は同時に preview も先頭から再構築する。過去 URL や削除済み URL の復活を防ぐためである
- 削除済み URL の tombstone は持たない。Yuru の再起動や session の再開だけでは復活しないが、watch 開始後の新しい user / assistant message に同じ URL が再び現れた場合は新規 bookmark として追加される
- standalone terminal の出力は対象外。bookmark 取得側は main worktree か task worktree かを特別扱いせず、provider session runtime に渡された worktree を保存先にする
- renderer に共通の `openExternal` callback は置いていない。各利用箇所が preload API を直接呼び、Bookmark は失敗をユーザー向け toast にも表示する。main は全呼び出しで http/https を検証し、IPC の失敗を Error Center に記録する

## 実装時の変更（2026-08-23 の会話・後半）

- **クリック登録を追加**。ターミナルで URL リンク（buffer link provider / OSC 8 ハイパーリンク）をクリックすると、開くと同時にブックマークへ登録する。ユーザーの自分のメッセージもターミナルにエコーされるため同じ経路で拾える。エージェントが出した URL で「後で必要になるもの」はクリック時に意図が表れる
- **ログからの自動追加は feature flag 化**。`YURU_BOOKMARK_AUTO_CAPTURE=1` を付けて起動したときだけ有効（デフォルト OFF）。クリック登録の体験が十分かどうかを比較するための措置で、体験が良ければ自動追加の実装は削る
- flag OFF のとき Kimi は `wire.jsonl` を一切読まない。`SessionLogWatcher.hasListeners` で listener の有無を見てから読む（需要駆動）。Claude / Codex は preview のために同じ reader を読むので listener の有無でコストは変わらない
- クリック登録用に `bookmarks:add` IPC を追加。main 側で http/https を検証し、title 解決は自動追加と同じ経路（fetch + GitHub は `gh api`）を使う

## 既存ソリューション調査

同等の「worktree/タスクに紐づくリンク集」機能は、調べた範囲では見つからなかった。

- **cmux**: 内蔵ブラウザを split pane として開ける。ターミナルの URL クリックをインターセプトして内蔵ブラウザで開く。ソケット API / CLI（`cmux browser open` 等）が充実しており、エージェントからブラウザを操作できる。ただし「リンクを蓄積する一覧」はなく、その場で開くだけ
- **herdr**: TUI の agent multiplexer。pane 管理と agent 状態表示が中心で、リンク管理の機能は見つからなかった
- **Codex app (desktop)**: worktree 単位のタスク管理と Handoff が中心。ブックマーク相当の機能は見つからなかった
- **Claude Desktop**: Code タブで worktree 管理ができるが、ブックマーク相当の機能は見つからなかった
- **Cursor / VS Code**: 「ブックマーク」はコード行へのマーク（エディタ内ナビゲーション）の意味で使われており、今回の外部リンク集とは別概念

示唆: cmux の「ターミナルの URL を検出してアクションにつなげる」は体験 4 の方向性と一致する。

## 設計（Step 1 で実装するもの）

### データモデル・永続化

- file review の先例（`src/main/review/store.ts`）に倣い、`~/.yuru/bookmarks.json` に worktreePath をキーにして保存する別 JSON とする。`metadata.json` には混ぜない
- worktree 削除フロー（`src/main/service.ts` の削除処理）から `removeBookmarks(worktreePath)` を呼んでクリーンアップする（file review と同じ）
- 型:

```ts
type Bookmark = {
  url: string;
  title: string; // 必須。解決できない間は URL 文字列が仮 title として入る
};
```

### UI

- `src/renderer/explorer/ExplorerPanel.tsx` の `ExplorerTab` に `"bookmarks"` を追加し、Search の右隣にタブを並べる
- ペイン内はブックマークの縦リスト。クリックで既存の `openExternal`（http/https 限定で `shell.openExternal`）に渡す
- 削除は各行のボタンから行う（ノイズ掃除のために UI からの削除は最初から必要）
- 手動追加・並び替え・更新 UI は無し（追加順固定）

### 会話に現れた URL の自動追加

- provider の保存ログを増分で読み、稼働中セッションの user / assistant メッセージ本文に追記された URL を追加する。tool result、内部の指示や調査ログ、通常のターミナル出力は対象にしない
- 既存セッションの再開直前に reader をログ末尾へ進め、過去の URL や削除済みの URL を再追加しない
- URL 検出は `terminalLinks.ts` と共通の関数を使い、main 側で URL 完全一致の重複を排除して bookmarks.json に追加する
- **title 解決の方針**（実機確認済み）:
  - 基本は **URL を fetch して `<title>` を取る**。public な GitHub ページもこれで取れる（例: `Issue タイトル · Issue #5778 · cli/cli · GitHub`）
  - **GitHub の issue / PR URL**（`github.com/{owner}/{repo}/{issues|pull}/{n}`）だけ特別扱いし、`gh api repos/{owner}/{repo}/issues/{n}` で解決する。issues エンドポイントは PR も返すのでページ種別ごとに API を分けなくてよい。private リポジトリでもユーザーの gh 認証で取れる
  - なお GraphQL の `resource(url:)` は URL をそのまま解決できるが、実機検証では Issue / Repository は解決できて PR URL は null になり、挙動が安定しなかったため採用しない
  - どちらでも取れなければ URL を仮 title のまま残す。再試行はしない
- **ノイズ**: フィルタは入れず、localhost を含め全て取り込む。掃除は UI からの削除で行う

## 今後の検討（Step 2 以降）

- **追加経路 3（API + スキル）**: Unix ソケット API（`src/main/api/server.ts`）に `bookmark.add` 等を追加すれば 3-1 / 3-2 が成立する。土台は `worktree.create` と同型で揃っている。体験 4 の使い勝手を見て要否を判断する
- **追加経路 2（ターミナルからの手動追加）**: コンテキストメニュー / DnD の基盤が現状無く、新規実装になる
- **手動追加 UI**: 体験 4 で取りこぼすもの（ターミナルに出ないリンク）への備え。要否は Step 2 で判断
