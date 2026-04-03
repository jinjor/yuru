# Yuru Design Doc

## 1. Overview

### What is Yuru?

Vibe Coding 専用のデスクトップエディタ。Claude Code を中心に据えた開発体験を提供する。

### Problem

- Claude Code はターミナルで使うが、セッション管理（`--resume`）が煩雑
- worktree を使った並行作業の管理が難しい
- diff/status の確認にエディタとターミナルを行き来する必要がある
- 複数リポジトリで作業する時にウィンドウ切り替えがストレス

### Differentiation

既存エディタ（VSCode, Cursor 等）の下位互換にならないよう、以下の差別化ポイントを優先する:

1. **セッション管理**: resume セッションの一覧・選択・プレビューを常時表示
2. **Worktree 管理**: 作成・切替・削除を GUI で直感的に
3. **Diff/Status**: セッションに紐づいた worktree の変更をリアルタイム表示
4. **複数リポ横断**: 1ウィンドウで全リポのセッションを管理

ファイルツリー、シンタックスハイライト、blame 等は既存エディタと同じ土俵の機能であり、後回しとする。

## 2. Architecture

### Session-Centric Design

セッションがアプリケーション全体のトップレベルの概念。リポジトリや worktree はセッションの属性として扱う。

セッションを選択すると、そのセッションに紐づく全ての情報（会話、変更ファイル、コード）が連動して表示される。

### 4-Column Drill-Down Structure

左から右に向かって詳細度が上がるドリルダウン構造。

```
1. Sessions   │ 2. Conversation  │ 3. Changes/Files │ 4. Code/Diff
──────────────┼──────────────────┼──────────────────┼──────────────
セッション一覧 │ エージェント会話  │ 変更ファイル一覧  │ コード差分表示
(全リポ横断)   │ (メイン表示)     │ ファイルツリー    │ シンタックス
              │ Shell (optional) │                  │ ハイライト
Archived      │                  │                  │
(折りたたみ)   │                  │                  │
```

#### Column 1: Sessions

全リポジトリ・全 worktree のセッションをフラットに一覧表示する。

各セッションカードの表示内容:
- リポジトリ名 / worktree 名（ラベル）
- ステータス（running / waiting / archived）
- プレビュー（最新の出力から数行、ANSI エスケープ除去）
- 最終更新日時

操作:
- **[+] ボタン**: 新規セッション作成（リポ選択 → worktree 作成 or なし → claude 起動）
- **セッションクリック**: Claude が生きていれば表示、終了していれば `claude --resume <id>` で再起動
- **Archived セクション**: 折りたたみ。worktree 削除済みセッションの履歴

#### Column 2: Conversation / Shell

選択中セッションのメインビュー。

- **会話**: Claude Code のターミナル出力（xterm.js）。常にメインとして表示
- **Shell**: 同じ worktree の cwd で起動する素のターミナル。optional で、必要に応じてタブとして追加。会話と並列に存在

#### Column 3: Changes / Files

選択中セッションの worktree に連動。

- **Changes タブ**: `git status` で検出した変更ファイルの一覧。ステータス（M/A/D/R）付き
- **Files タブ**: worktree のファイルツリー

ファイルをクリックすると Column 4 にコード/差分が表示される。

#### Column 4: Code / Diff

Column 3 で選択したファイルの内容表示。

- Changes からファイルを選んだ場合: diff 表示（before/after）
- Files からファイルを選んだ場合: コード表示（シンタックスハイライト付き）

### Column 間の連動

```
Session 選択 ──→ Conversation 切替
                  └──→ Changes/Files 切替（worktree 連動）
                                     └──→ Code/Diff 切替（ファイル連動）
```

Shell を選択した場合は Column 3〜4 はそのまま（直前のセッションの worktree 情報を維持する、または非表示）。

## 3. Session Lifecycle

### セッションの種類

セッションは作成時に worktree の有無を選択する。

- **worktree あり**: 単一タスク用。`git worktree add` で作業ディレクトリを分離
- **worktree なし**: リポのメインディレクトリで作業。雑多な作業、ブランチ切り替え等

同じリポに worktree なしのセッションが複数存在してもよい。

### States

セッションは 3 つの状態を持つ。全て外部の状態から導出でき、Yuru が永続化する必要はない。

```
  新規作成 → active
                │
                │ Claude 終了
                ▼
             inactive ←──── セッション選択で resume
                │
                │ cwd 消失（worktree 削除 or リポ削除）
                ▼
             archived
```

| 状態 | 条件 | UI |
|------|------|-----|
| active | pty が生きている（Yuru のランタイム状態） | プレビュー更新中。選択中なら Column 2〜4 に表示 |
| inactive | pty がない & `fs.existsSync(cwd)` | プレビュー（最後の出力）が残る。選択したら resume で active に |
| archived | `!fs.existsSync(cwd)` | Archived セクション（折りたたみ）。読み返しのみ、resume 不可 |

#### 状態遷移の詳細

- **active → inactive**: Claude のプロセス終了を検知したら pty を閉じる。セッションカードにはプレビュー（最後の出力）が残る
- **inactive → active**: セッションを選択すると `claude --resume <session-id>` で pty を spawn して自動再起動
- **active/inactive → archived**: cwd（worktree パス or リポルート）がファイルシステム上から消失。worktree ありの場合は worktree 削除（PR マージ or 放棄）、worktree なしの場合はリポ削除

#### 起動時の状態

アプリ起動直後は全セッションが inactive。pty は1つも存在しない。ユーザーがセッションを選択して初めて active になる。

#### archived セッションの扱い

- Sessions 一覧の「Archived」セクション（折りたたみ）に表示
- 会話履歴を読み返すことができる（`~/.claude/projects/` のデータは残る）
- resume は不可（cwd が存在しないため）
- 最終更新日時でソートされ、古いものは下に沈む

#### worktree なしセッションの寿命

worktree なしセッションの cwd はリポのルートであり、通常は消えない。したがって inactive のまま残り続ける。これは意図的な設計:
- メインディレクトリで複数の PR を跨いで作業するケースがある
- 古いセッションは最終更新日時で下に沈むため、一覧を圧迫しない
- リポ自体を削除すれば自動的に archived になる

### Claude プロセス状態の検知

1. **`~/.claude/sessions/` の監視**: PID ファイルの出現・消失を fs.watch で監視
2. **pty 子プロセスの監視**: pty の子プロセスとして claude が動いているかを確認

### pty 管理

- active セッションのみ pty を保持
- Claude 終了検知 → pty を閉じる（再 spawn しない。inactive になる）
- セッション選択時に inactive なら `claude --resume <id>` で新しい pty を spawn
- セッション切替時は xterm.js インスタンスを切り替え（他の active セッションの pty は裏で動き続ける）
- archived セッションは pty を持たない

## 4. Data Model

### Workspace

Yuru は単一のワークスペースを持つ。`yuru` コマンドで毎回同じワークスペースが開く。ワークスペースのデータは `~/.yuru/` に保存する。

#### `~/.yuru/config.json`

ユーザーが意図的に変更する設定:
- `repositories`: 登録リポジトリ一覧（パスの配列）

```json
{
  "repositories": [
    "/Users/jinjor/projects/yuru",
    "/Users/jinjor/projects/other-project"
  ]
}
```

#### `~/.yuru/state.json`

アプリが自動的に保存・復元する状態:
- `window`: ウィンドウのサイズ・位置
- `selectedSessionId`: 最後に選択していたセッション
- `columnWidths`: 各列の幅

```json
{
  "window": { "x": 100, "y": 100, "width": 1400, "height": 900 },
  "selectedSessionId": "abc-123",
  "columnWidths": [220, 500, 250, null]
}
```

### Session Data (Claude Code)

Claude Code のセッション情報は `~/.claude/` 配下に保存されている。

#### `~/.claude/projects/<encoded-cwd>/`

セッションの JSONL ファイルが格納される。ディレクトリ名は CWD パスの `/` を `-` に置換したもの（例: `/Users/jinjor/projects/yuru` → `-Users-jinjor-projects-yuru`）。

各セッションは `<session-uuid>.jsonl` として保存され、会話の全メッセージが含まれる。

**用途**: セッション一覧の構築、archived セッションの会話履歴表示

#### `~/.claude/sessions/`

実行中セッションの PID マッピング。`<pid>.json` 形式で以下の情報を含む:
- `sessionId`: セッション UUID
- `cwd`: 作業ディレクトリ
- `startedAt`: 開始時刻
- `kind`: セッション種別
- `name`: セッション名

**用途**: Claude プロセスの running/stopped 判定

#### `~/.claude/history.jsonl`

全セッション横断のメッセージ履歴。各エントリは:
- `project`: CWD パス
- `sessionId`: セッション UUID
- `display`: メッセージテキスト
- `timestamp`: タイムスタンプ

**用途**: セッション一覧のプレビューテキスト取得、最終更新日時の取得

### Worktree Data

#### `git worktree list`

リポジトリの worktree 一覧を取得。各 worktree のパスとブランチ名がわかる。

#### `.git/worktrees/`

ファイルシステムの変更を fs.watch で監視し、外部（ターミナルや Claude Code 自身）からの worktree 作成・削除を検出する。

### Session → Worktree Mapping

セッションの cwd から worktree を判定する:

1. セッションの cwd を取得
2. その cwd で `git worktree list` を実行
3. cwd が worktree 一覧のどれに該当するかでリポ名と worktree 名を判定

### 状態判定

全てのセッション状態は外部の状態から導出される。Yuru が状態を永続化する必要はない。

| 状態 | 判定方法 |
|------|---------|
| active | Yuru のランタイムで pty が生きている |
| inactive | pty がない & `fs.existsSync(cwd)` が true |
| archived | `fs.existsSync(cwd)` が false |

起動時に全セッションの cwd を走査して inactive/archived を判定（起動直後は active なし）。以降は `.git/worktrees/` の fs.watch で cwd 消失を検出。

### Preview Data

pty の出力ストリームから最新の数行を保持する:
- ANSI エスケープシーケンスを除去
- 最新3行程度をバッファリング
- セッションカードのプレビューとして表示

## 5. Worktree Integration

### Worktree の役割

worktree は**オプション**。セッション作成時に「worktree を作る / 作らない」を選べる。

- **worktree あり**: 単一タスク用の隔離された作業ディレクトリ。worktree 削除で自動 archived
- **worktree なし**: リポのメインディレクトリで作業。ブランチ切り替えも自由。リポ削除で archived

### Claude Code の Worktree 機能への委譲

worktree の作成・削除は Claude Code の組み込み機能に委譲する。Yuru が `git worktree add` や gitignored ファイルのハンドリングを自前で実装する必要はない。

#### CC の worktree 機能

| 項目 | 内容 |
|------|------|
| CLI | `claude --worktree <name>` (`-w`) |
| 作成先 | `<repo>/.claude/worktrees/<name>/` |
| ブランチ | `worktree-<name>` を自動作成（`origin/HEAD` から分岐） |
| gitignored ファイル | `worktree.symlinkDirectories` 設定で symlink 対象を指定 |
| 終了時 | 変更なし→自動削除、変更あり→keep/remove を確認 |

#### CC の worktree 設定（ユーザーが設定）

```json
// ~/.claude/settings.json or .claude/settings.json
{
  "worktree": {
    "symlinkDirectories": ["node_modules", ".cache"],
    "sparsePaths": ["src/", "packages/my-service/"]
  }
}
```

- `symlinkDirectories`: worktree 作成時にメインからシンボリックリンクを張るディレクトリ
- `sparsePaths`: git sparse-checkout で取得するパス（大規模リポ向け）

### 新規セッション作成フロー

```
[+] クリック
  → リポジトリ選択（登録済みリポ一覧 or フォルダ選択で新規追加）
    → worktree を作る / 作らない
       ├─ 作る → 名前入力 → `claude --worktree <name>` で pty spawn
       │         CC が worktree 作成 + symlinkDirectories 適用
       │         セッションの cwd = <repo>/.claude/worktrees/<name>/
       └─ 作らない → リポのルートで `claude` を起動
         → Yuru が session ID を記録
```

### セッション再開

全セッションの再開は `claude --resume <session-id>` で統一。`--continue` は使わない。Yuru が session ID を管理しているため、任意のセッションを正確に再開できる。

**注意**: CC の既知バグとして、`--resume` 時に cwd がリポルートに戻る問題がある（[#30906](https://github.com/anthropics/claude-code/issues/30906)）。Yuru 側で worktree パスを記憶しておき、resume 時に正しい cwd で pty を spawn することで回避する。

### Worktree 削除フロー

CC の worktree は終了時に変更がなければ自動削除される。変更がある場合はユーザーに確認する。

Yuru 側では worktree の消失を検知してセッション状態を更新する:

```
worktree 消失（CC の自動削除 or ユーザーが手動で git worktree remove）
  → .git/worktrees/ の変更を検知
    → 該当 worktree に紐づくセッションを archived に変更
      → pty を閉じる
        → Sessions 一覧を更新（Archived セクションに移動）
```

### Worktree パスについて

CC の worktree は `<repo>/.claude/worktrees/<name>/` に作成される。リポと同階層ではなく `.claude/` 配下に格納される点に注意。Yuru はこのパス規約に従う。

### 外部からの Worktree 変更

ユーザーがターミナルや Claude Code から直接 worktree を操作した場合:
- `.git/worktrees/` の fs.watch で検出
- 新規 worktree: Sessions 一覧には自動追加しない（セッションがまだないため）。通常の [+] → リポ選択の流れで、既存 worktree として選択肢に表示される
- worktree 削除: 上記の削除フローと同じ

## 6. Shell

### 位置づけ

- Shell はエージェント会話の補助。`git commit` や `npm install` 等、Claude を通さず直接実行したい操作用
- Column 2（Conversation）内でタブとして会話と並列に存在
- デフォルトでは非表示。ユーザーが明示的に起動する

### Worktree との紐づき

- Shell は起動時にセッションの cwd（worktree or リポルート）で pty を spawn する
- ユーザーが cd で別ディレクトリに移動するのは自由（自己責任）
- Shell の cwd が変わっても、Column 3〜4 の表示には影響しない（セッションの cwd に紐づいたまま）

### Shell のライフサイクル

- セッション内で [+Shell] 等のアクションで起動
- ユーザーが明示的に閉じるか、セッションが archived になるまで生存
- セッション切替時は、切替先のセッションの Shell（存在すれば）が表示される

## 7. Multi-repo Support

### 動機

Cursor で Claude Code を使う時、複数リポジトリで同時作業するとウィンドウ切り替えがストレス。Yuru では1ウィンドウで全リポのセッションを管理する。

### リポジトリの登録

- 初回: [+] → フォルダ選択ダイアログでリポジトリを選択
- 登録済みリポジトリは永続化（設定ファイル or アプリの state）
- `~/.claude/projects/` をスキャンして過去に作業したリポジトリを自動検出することも可能

### セッション一覧での表示

全リポのセッションがフラットに並ぶ。リポ名 / worktree 名はラベルとして各カードに表示。worktree ありのセッションは視覚的に区別できるようにする（アイコン等）。

```
│ 🌿 session-2               │  ← worktree あり
│   yuru / feat-auth          │
│   "認証機能追加"             │
│    session-3                │  ← worktree なし
│   yuru                      │
│   "ファイル作成中…"          │
│    session-4                │  ← worktree なし
│   other-project             │
│   "テスト書いた"             │
```

ソート順はアクティビティ順（最終更新が新しいものが上）が自然。

### Column 3〜4 の連動

セッション選択時、Column 3（Changes/Files）と Column 4（Code/Diff）はそのセッションの worktree に切り替わる。リポが変わっても操作感は同じ。

## 8. Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Desktop Framework | Electron | 開発速度重視。AI コーディングとの相性が良い（TS エコシステムが豊富） |
| Language | TypeScript | 型安全性 + AI が生成しやすい |
| UI Framework | React | エコシステムの大きさ、AI の学習データの豊富さ |
| Terminal | xterm.js + node-pty@1.2.0-beta.12 | VSCode と同じ組み合わせ。node-pty の beta は数年続いており事実上の stable |
| Bundler | Vite (素の Vite) | 高速。electron-vite はコミュニティ製のため不使用 |
| Lint | oxlint | 高速 |
| Format | oxfmt | 高速 |
| Main/Preload Build | tsc | Vite は renderer のみ。main/preload は tsc で素朴にコンパイル |

### Build Configuration

- `tsconfig.json`: main/preload 用。target ES2022, module node16, strict
- `vite.config.ts`: renderer 用。React plugin, `src/renderer` を root に
- `npm run dev`: `tsc && vite build && electron .`
- `npm run build`: `tsc && vite build`

## 9. Future: GitHub Integration

将来的に GitHub と連携し、セッション/worktree の管理をさらに自動化する。

### PR ステータス表示
- セッションカードに PR の有無とステータス（open / merged / closed）を表示
- PR へのリンク

### オートメーション
- PR がマージされたら worktree を自動削除（→ セッションが archived に）
- PR 作成のショートカット（worktree のブランチから PR を作成）
