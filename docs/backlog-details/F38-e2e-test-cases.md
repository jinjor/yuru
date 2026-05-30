# F38 E2E Test Cases

Last updated: 2026-05-30

`F38`（provider 挙動の integration / e2e テスト基盤）の e2e テストケース計画と、実装ハーネスの設計メモ。
別セッションで実装を継続する前提の引き継ぎ資料。

## Status (2026-05-30)

- e2e ハーネスの実地検証が完了。**本物の Claude / Codex を使い、副作用を隔離した状態で worktree セッション作成まで通る**ことを確認済み。
- Playwright + Electron。`playwright.config.ts` の `testDir: ./test/e2e`、`testMatch: *.test.ts`、`workers: 1`。
- 既存 smoke (`test/e2e/smoke.test.ts`) に加え、Claude / Codex の作成フロー e2e を 2 本追加済み（下記 handoff 参照）。

## Handoff: 作業中ファイル

このブランチ（main）の working tree に、まだコミットしていない untracked ファイルが 2 つある:

- `test/e2e/create-claude-session.test.ts` — 本物 Claude で worktree セッション作成 → worktree 生成 + xterm 表示を検証
- `test/e2e/create-codex-session.test.ts` — 本物 Codex で worktree セッション作成 → さらに実ターンを 1 回走らせ、隔離 HOME に session 永続化（`.codex/sessions/*.jsonl`）が出ることまで検証

`npm install` 済み（`@playwright/test` が node_modules に無かったため入れた）。`package.json` の devDeps には元から記載あり。

実行: `npm run test:e2e`（事前に `npm run build` が必要。e2e は `dist` に対して走る）。
個別: `npm run test:e2e -- create-codex-session`。
注意: `npx playwright` は別バージョンを引くので使わない。`npm run test:e2e` 経由で。

## ハーネス設計（検証で分かった要点）

副作用の出口はほぼ全部 `HOME` 配下に集約される（provider の session store が `os.homedir()` 起点）。
PTY の子プロセスは Electron メインプロセスの env を継承する（`createTerminalEnv(process.env)`）。
よって launch 時に env で `HOME` と `YURU_HOME` を差し替えれば、provider の副作用ごと使い捨てディレクトリに閉じ込められ、`rm -rf` で消せる。

```
electron.launch({ args:[repoRoot], cwd:repoRoot,
  env: { ...process.env, HOME: tmpHome, YURU_HOME: tmpYuru } })
```

### 認証の借用（ローカル）

まっさら HOME には認証が無いので、実機の資格情報を借りる:

- **Claude**: 資格情報は macOS Keychain（`Claude Code-credentials`）。`security find-generic-password -s "Claude Code-credentials" -w` で取り出し、`<HOME>/.claude/.credentials.json`（0600）に書く。Keychain のままでは HOME 差し替え時に読まれず "Not logged in" になるので、ファイル形式に展開する必要がある。
- **Codex**: 資格情報は `~/.codex/auth.json`。隔離 HOME の `.codex/auth.json` にコピーするだけ。

### まっさら HOME の初回起動ガード（重要）

interactive 起動だと、認証だけでは provider が本来のセッションを開始せず、初回起動ガードで止まる。テスト用に事前回避が必要:

- **Claude**: `<HOME>/.claude.json` に `hasCompletedOnboarding: true` と、対象 repo を信頼済みにする `projects: { "<repoRealpath>": { hasTrustDialogAccepted: true } }` を書く。
- **Codex**: `<HOME>/.codex/config.toml` に `[projects."<repoRealpath>"]` の `trust_level = "trusted"` を書く。これが無いと「Do you trust the contents of this directory?」で止まり、入力がそのダイアログに吸われる。

### realpath の罠

macOS の `/tmp` → `/private/tmp` シンボリックリンクで、provider は cwd を realpath 解決する。**信頼キーと、Yuru metadata に登録する repoPath は realpath で揃える**こと（`fs.realpathSync` 済みの temp repo を使う）。HOME 自体は `$HOME` として文字列で渡るだけなので realpath 不要。

### Codex のターン送信タイミング（フレーキー対策）

Codex は session id を遅延解決する設計（`resolvesSessionIdLazily: true`）。worktree 作成成功＝認証成功とは限らないので、認証まで強く保証したい場合は実ターンを 1 回走らせて `.codex/sessions/*.jsonl` の出現を待つ。
その際、TUI 起動完了（ターミナルに "OpenAI Codex" が出る）を待ってから入力し、**打鍵と Enter の間に ~1.5s の間を置く**こと。間が無いと Enter が入力取り込みとレースしてターンが送信されない。session ファイルは送信から約 1s で出る。

Claude は逆に `waitForSessionId` がセッション登録を待つ作りなので、worktree 作成成功の時点で「認証して起動した」が既に保証される。追加ターンは不要。

## テスト用 HOME の置き場所

`os.tmpdir()` + `mkdtemp`（prefix `yuru-e2e-`）を使う。実機 macOS では `os.tmpdir()` は `/var/folders/.../T`（ユーザー専用・0700）で、借用した資格情報を一時的に置く先として妥当。
避けること:

- `/tmp` 直書き（macOS では全ユーザーが辿れる共有領域。資格情報を置くべきでない）。
- リポジトリ内（`test-results/` 等）。git/watcher の走査に巻き込まれ、かつ資格情報がリポジトリ配下に落ちる。HOME は必ずリポジトリ外。

CI（Linux の共有 `/tmp`）では資格情報コピー方式を使わず、`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` をシークレットで env 注入する方式に切り替える。「資格情報を temp に借用」はローカル開発専用の手段。

## テストケース一覧（~58）

凡例:
`[git]` git+metadata だけで完結（速い・決定的） / `[shell]` 素のシェル PTY / `[claude]` `[codex]` 本物 provider が必要 / `[restart]` アプリ再起動が必要 / 💸 実モデルのターンを走らせる（遅い・課金・要 quarantine） / ⚠️ フレーキー注意

### A. 起動・空状態

1. `[git]` アプリ起動、タイトル "Yuru"（既存 smoke）
2. `[git]` repo 未登録 → サイドバーに "No repositories"
3. `[git]` 選択なし → 右ペインに "Select a session to resume"
4. `[git]` 登録した repo が basename + path 付きで表示される
5. `[git]` task worktree 0 件の repo でも repo 行と "+" が出る
6. `[git]` provider が無いと "+" が disabled

### B. 一覧の描画

7. `[git]` task worktree 行に branch 名＋ブランチアイコン
8. `[git]` main worktree が専用カード（hint "terminal"）で出る
9. `[git]` main worktree は task worktree 一覧に混ざらない
10. `[git]` detached HEAD は "detached @ <sha>" 表示
11. `[git]` コミット無し worktree は "(no commits)" 表示
12. `[git]` metadata に無い Git worktree も primary なしで表示される
13. `[claude]` primary を持つ worktree に provider dot＋プレビューが出る
14. `[claude]` suggested session ありの worktree に "N existing session(s)"

### C. 作成フロー・モーダル

15. `[git]` "+" で Create Worktree モーダル（provider ボタン＋入力欄）が開く
16. `[git]` デフォルト branch 名が pre-fill＆全選択される
17. `[git]` 不正な branch 名（空白・記号）→ 検証メッセージ＋Create 無効
18. `[git]` 末尾 "/" の branch 名は無効
19. `[git]` Escape でモーダルが閉じる
20. `[git]` モーダル外クリック／キャンセルで閉じる
21. `[git]` 既存 branch 名で作成 → エラー表示、モーダル維持、worktree 未作成
22. `[claude]` branch 名 `feat/x` → worktree ディレクトリは `feat-x`
23. `[git]` 作成後、新 worktree 行が repo 配下に現れ選択状態になる

### D. ターミナル・PTY

24. `[shell]` main worktree で standalone terminal を開くとシェルが起動
25. `[shell]` xterm が描画され、シェルプロンプトが出る
26. `[shell]` ターミナルへの入力がエコーされる（ptyWrite↔onPtyData）
27. `[git]` ターミナルバーに現在の branch 名が出る
28. `[shell]` PTY を exit するとプレビューに戻る（選択解除）
29. `[shell]` ⚠️ worktree 選択を切り替えるとターミナルも入れ替わる（取り違えない）
30. `[shell]` ターミナル出力中のファイルパスリンクで diff プレビューが開く
31. `[shell]` URL リンクで openExternal が呼ばれる

### E. Files パネル

32. `[git]` Files タブで選択中 worktree の追跡ファイル一覧が出る
33. `[git]` ファイルクリックで source/diff プレビューが開く
34. `[git]` 一覧が選択中 worktree のものだけになる（他 worktree が混ざらない）
35. `[git]` ⚠️ ディスク上に新規ファイルを作ると watcher で一覧に現れる

### F. Changes・diff

36. `[git]` Changes タブに変更ファイルと状態が出る
37. `[git]` 未追跡ファイルが untracked/added として出る
38. `[git]` 変更ファイルクリックで diff（追加/削除行）が開く
39. `[git]` ⚠️ 同じファイルを再変更すると diff がポーリング更新される
40. `[git]` プレビューの閉じる操作で no-preview レイアウトに戻る

### G. 検索

41. `[git]` Cmd+P でファイル検索パレットが開く
42. `[git]` クエリで絞り込み→選択でプレビューが開く
43. `[git]` Escape でファイル検索が閉じる
44. `[git]` Cmd+Shift+F で Search タブに切替＆入力にフォーカス
45. `[git]` code search が worktree 横断でマッチ行を返す

### H. resume・promote（事前に provider セッションを用意）

46. `[claude]` inactive な primary を resume → ターミナルが active になる
47. `[claude]` すでに active な primary を選択 → 新 PTY を作らず既存を選ぶ
48. `[claude]` suggested session を promote → primary に昇格＆選択
49. `[claude]` provider store から消えた primary → detach される

### I. remove・ライフサイクル

50. `[git]` active セッションの無い worktree を remove → Git worktree＋metadata record が消える
51. `[claude]` active primary がある worktree は remove がブロックされる
52. `[git]` 選択中の worktree を remove すると選択が解除される

### J. 永続化・再起動

53. `[restart]` metadata が再起動後も保持され worktree が出続ける
54. `[restart]` terminal runtime は永続化されない（再起動後 inactive）
55. `[restart]` 起動時 maintenance が stale な strong link を削除し repo は残す

### K. レイアウト

56. `[git]` サイドバーのリサイズで幅が変わる（clamp 範囲内）
57. `[git]` Changes パネルのリサイズが効く
58. `[git]` プレビュー分割のリサイズが効く

## 優先順位と進め方

- **土台は `[git]`/`[shell]` を厚く** — 本物 AI 不要で速く決定的。A〜G の多く・I・J・K。費用対効果が高い。
- **`[claude]`/`[codex]` は最小限** — 認証隔離の価値を証明する 22・27・28・46〜49 あたりに絞る。💸（実モデルのターン）は Codex の session 永続化検証くらいに留め、quarantine タグで通常 CI から分離。
- **事前条件づくり**: 13・14・46〜49 は「先に provider セッションを 1 つ作る or store ファイルを seed する」準備が必要。後者（store に session ファイルを直接置いて AI を走らせない）が速く決定的にできる可能性があり、要調査。
- **⚠️ フレーキー候補**（29・35・39）は watcher/ポーリング待ち。`toPass` / `toContainText` のリトライで吸収する前提。
- **GitHub PR バッジ（旧 15 案）は e2e から除外** — `gh`/ネットワーク依存で隔離が難しい。単体テスト向き。

### 次セッションの着手順（案）

1. 共通ヘルパー（temp HOME・認証シード・Claude/Codex の初回起動ガード seed・repo 準備・launch・cleanup）を `test/e2e/` 配下に切り出す。今は 2 本のテストに直書きされているので、まずここを共通化。
2. `[git]`/`[shell]` 群を一気に実装。
3. provider 系を少数。先に「store に session を seed して resume/promote を AI 無しで検証できるか」を調査し、優先度を確定。
