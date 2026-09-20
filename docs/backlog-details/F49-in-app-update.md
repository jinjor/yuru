# F49 UI から Yuru を最新版へ更新する

Last updated: 2026-09-17

## やりたいこと

今の手順を自動化する。

```
Yuru を終了 → コンソールで yuru latest → yuru で開き直す
```

これを、サイドバーの行を押す → しばらくグルグル → `Restart to update` に変わる →
もう一度押すと Yuru が入れ替わって立ち上がる、にする。

やらないこと: 更新があるかどうかの事前チェック、更新中のコマンド出力を画面に出すこと。

## 何が難しいか

`yuru latest` の最後は `~/Applications/Yuru.app` の丸ごと差し替えで、起動中の app に対して
やると壊れる (古いプロセスが、あとから新しいバンドルのファイルを読む)。だから CLI には
「Yuru.app が起動中なら中断する」というガード (`ensureAppNotRunning`) がある。

一方、それ以外の処理 (fetch / pull / audit / npm ci / build) は `~/.yuru/repo` の中だけで
完結し、起動中の Yuru には何の影響もない。

## 設計

更新を、Yuru の終了を挟んで 2 つに分ける。

| | やること | 時間 | Yuru |
|---|---|---|---|
| 前半 | fetch / pull / launcher 更新 / audit / `npm ci` / build | 数分 | 起動したまま。ふつうに作業できる |
| 後半 | `npm run package:local` (パッケージング + 差し替え) → 起動し直す | 1 分程度 | 終了している |

前半が終わった状態で止めて、後半に進むかどうかをユーザーが決める。
前半は起動中の Yuru に何も影響しないので、走っている間も作業を続けられる。
長くて失敗しやすい処理 (ネットワーク、audit、build) はすべて前半なので、失敗しても
Yuru は何も失わずに動き続ける。

分け目を「パッケージングの前」に置くのがポイント。ここで切ると
`scripts/package-local-app.mjs` は今のまま使え、作りかけの app を受け渡す仕組みも要らない
(あのスクリプトは自分で一時ディレクトリを作って、終わったら消す)。

## UI

画面はサイドバー下部の 1 行だけ。`Errors` の行と並べて置く
(worktree ではなく app 全体の操作なので `Errors` と同じ場所)。

| 行 | 押すと |
|---|---|
| `Update Yuru` | 前半を開始する |
| `Updating…` (グルグル) | 何もしない |
| `Restart to update` | 後半へ進む。Yuru が終了し、1 分ほどで新しい Yuru が立ち上がる |
| `Restart to update` の右端のボタン | 前半をもう一度走らせる (`Updating…` に戻る) |

作業中のセッションがあるかどうかは行に出さない。左ペインの worktree カードのドットが
点滅しているので、上から下まで眺めれば分かる。それを見逃したまま押した時の保険として、
`Restart to update` を押した時点で作業中のセッションがあれば警告を 1 枚だけ挟む。
何が動いているかはその裏に見えているので、ダイアログには書かない。
作業中のセッションが無ければ、押すとそのまま終了する
(開いているだけの terminal は閉じるが、あとから resume できる)。

前半のコマンド出力は画面に出さず、`~/.yuru/update.log` に書く。

### ready のまま放置した時

`ready` のまま放置している間に repository が進むことがある。そのために
`Restart to update` の行の右端に、もう一度 update を走らせるボタン (`icon-button`) を置く。
押すと `Update Yuru` を押した時と同じで、`Updating…` に戻って最新を取り直す。

行の側では陳腐化を判定しない。フェッチのポーリングも、build 済みの commit の記録も要らない。

押した時は毎回 pull から build までを丸ごとやり直す。repository に更新が無ければ同じ内容を
build し直すだけになるが、それでよい。「更新が無ければ何もしない」にすると、`ready` に
なった後で build 済みの中身が壊れた時 (dist や node_modules が壊れる、途中で止まるなど) に
「repository は最新なので何もしない」となって復旧できなくなる。
このボタンは最新を取り直す操作であると同時に、build し直す操作でもある。
`yuru latest` が毎回 build し直すのと同じ理由。

## app 側

app 全体の関心事なので、error center や plan usage monitor と同じく `YuruService` の外に置く
(`src/main/yuru-update/updater.ts`)。持つ状態は次の 4 つだけ。作業中のセッションがあるかどうかは
既存の活動状態から毎回導出する (状態として持たない)。

```ts
export type YuruUpdatePhase = "unavailable" | "idle" | "updating" | "ready";
```

- IPC: `update:getState` / `update:start` / `update:restart` と、状態変化の push 1 本。
  `ready` からの再実行も `update:start` で足りる
- 前半は `node <managed checkout>/scripts/yuru-cli/index.mjs latest --update-checkout` を起動し、
  出力は `~/.yuru/update.log` へ流す
- 後半は `detached: true` + 同じログファイル + `unref()` で起動し、そのあと `app.quit()` する
- `node` の絶対パスとログインシェルの `PATH` は、agent と同じ `resolveCommandPaths` で解決する。
  Finder から起動した Electron の `PATH` には node も npm も git も無い。`node` が
  見つからなければ `unavailable`
- `ready` のまま Yuru を終了した場合、build 済みの checkout はそのまま残る。次に
  `Update Yuru` を押すと同じ手順をもう一度走るだけなので、後片付けは要らない

## CLI の変更

手順とガードは CLI (`scripts/yuru-cli/local-commands.mjs`) に置いたままにする。
app 側は managed checkout の CLI を node で実行するだけにする。

`updateApp()` を 2 つに割る。

- `updateCheckout()`: `ensureAppNotRunning` 以外のガードはそのまま + fetch / pull / launcher 更新 /
  audit / `npm ci` / build
- `replaceApp()`: Yuru.app のプロセスが 1 つも残らなくなるまで待ち (`ensureAppNotRunning` と同じ
  `ps` の見方。最大 60 秒) → `npm run package:local` → `open -na Yuru.app`

`yuru latest` (引数なし) は今までどおり `ensureAppNotRunning` → 両方を続けて実行し、再起動はしない。
app が使うのは `yuru latest --update-checkout` と `yuru latest --replace-app` の 2 つで、
`yuru help` には載せない。

## 使える条件と開発版の扱い

差し替え先は `~/Applications/Yuru.app` なので、いま動いているのがその app 自身のときだけ
更新できる。それ以外は `unavailable` にして、行を無効にしたまま理由を出す。

- 開発版 (`npm run app:restart`) は node_modules の `Electron.app` を worktree の path を
  引数にして起動するので、`app.isPackaged` が常に false。これで判定できる
- packaged でも `app.getAppPath()` が `<appsDir>/Yuru.app/Contents/Resources/app` でなければ
  同じく `unavailable`。managed checkout が無い場合と macOS 以外も同じ
- 行は隠さず、無効のまま置く。開発中も本番と同じ見え方にしたいのと、押せない理由が
  分かる方がよいため (menu の `Settings...` と同じ扱い)
- 開発版から更新が走らないので、「エージェントは `yuru latest` を実行してはならない」
  (CLAUDE.md) とも衝突しない

開発版を起動したままでも、インストール版からの更新は成立する。開発版は `Electron.app` の
プロセスなので後半の `ps` 判定 (`Yuru.app/Contents/MacOS` を見る) に引っかからず、
`~/Applications/Yuru.app` の中身も読んでいない。Yuru を 2 つ起動する普段の使い方のまま、
インストール版だけを更新できる。

インストール版を 2 つ起動している場合は、後半が 60 秒待って諦め、差し替えずに起動し直す
(下記「後半の失敗」と同じ)。事前の検査は入れない。

この機能自体の検証は、updater の子プロセス起動を差し替えた unit test で行う。
E2E は開発版として動くので、`unavailable` の表示までしか見られない。

## 失敗したらどうなるか

- **前半の失敗** (ガード、fetch、audit、npm ci、build): Yuru はそのまま動き続ける。
  行は `Update Yuru` に戻る。`ready` からの再実行が失敗した時も同じで、`ready` には
  戻さない (pull だけ済んで build が失敗した checkout を install させないため)。失敗は error center に error として記録する
  (message は 1 行、detail に出力の末尾)。`Errors` の数字が増えるので気づける。
  更新用の失敗表示は別に作らない
- **後半の失敗** (終了を待ちきれない、パッケージングの失敗): `package-local-app.mjs` は
  差し替えに失敗すると旧 app を書き戻すので、`open -na Yuru.app` で戻ってくるのは旧版。
  何が起きたかは `~/.yuru/update.log` に残る。ユーザーから見ると「更新されずに戻ってきた」

再起動後、開いていた terminal は復元されない。通常の起動と同じで、Terminal ホームから resume する。

## テスト

- `test/main/yuru-cli.test.mjs`: 既存の「PATH に偽の git / npm / ps を置く」仕掛けを使い、
  `--update-checkout` が `package:local` まで行かないこと、`--replace-app` が app の終了を
  待ってから `package:local` と `open` を呼ぶことを見る
- `test/main/update/updater.test.mjs`: 子プロセスを差し替えて状態遷移を見る
