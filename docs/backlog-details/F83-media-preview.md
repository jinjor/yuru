# F83: 音声・動画のプレビュー

Last updated: 2026-09-17

backlog には未登録。ID は仮置き。

モックアップ: [../mockups/F83-media-preview.html](../mockups/F83-media-preview.html)

## この doc の範囲

preview パネルで音声・動画を再生できるようにする。Files から開いた時と Changes から開いた時の
両方を対象にし、before/after の見せ方もここで決める。

**いま困っているのは「何も再生できないこと」**なので、目的は再生できるようにすること。
凝ったプレイヤーは作らない。画像プレビュー（`ImagePreview` + `image-diff.ts`）が既にある構図に
そのまま乗せる。

## 決めたこと（要約）

| 論点 | 決定 |
| --- | --- |
| プレイヤー | 作らない。`<audio controls>` / `<video controls>` を置くだけ |
| 置き場所 | 既存の preview パネルの「プレビュー」モード。画像と同じ扱いで、閲覧は binary、編集は不可 |
| diff の構図 | 画像とまったく同じ枠。片側だけなら 1 面、両側あるなら Before / After の 2 カラム |
| diff の中身 | **並べたメタ情報で比べる**。画像の `1920 × 1080 · 2.4 MB` と同じ位置に、長さ（動画は寸法も）とサイズを出す |
| 対応形式 | 音声・動画として扱う拡張子の allowlist。再生できなければ要素の `error` で fallback 表示 |
| 中身の運び方 | **ファイルの URL を渡すだけ**。中身はアプリのメモリを通さず、Chromium がディスクから読む |
| 画像との関係 | **同じ仕組みに揃える**。画像も data URL をやめて URL を渡す形にし、IPC は 1 本にする |
| 更新の追従 | 3 秒ごとに大きさと URL を取り直す。URL に中身の識別子が入っているので、変われば要素が読み直す |
| 再生中の差し替え | 再生位置と再生状態を保って差し替える |
| サイズの上限 | **無し**。中身をメモリに載せないので要らない |
| 再生開始 | 自動再生しない |

作らないもの: 自前のトランスポート、波形、before/after の時間軸の共有、A/B の音の切り替え。

## 1. プレイヤーはブラウザのものを使う

Electron は Chromium なので、`controls` を付ければ再生・シーク・音量・再生速度・全画面・
Picture-in-Picture・キーボード操作が全部ついてくる。自前で作る価値があるのは
「before/after で 1 本のタイムラインを共有する」ところだけで、そこまでは要らない。

- `controlsList="nodownload"` でダウンロードボタンだけ消す（保存は Files から普通にできる）。
  再生速度は残す（録画の確認で使う）。
- `preload="metadata"` を付ける。長さと寸法をメタ情報に出すために要素に読ませる必要があり、
  中身全体を先読みする必要はない。
- アプリが `color-scheme: dark` を指定しているので、コントロールは暗い側で描かれる。
  そのうえで、音声コントロールの地の色だけ `::-webkit-media-controls-panel` でアプリの色に寄せる
  （既定はグレーのピルで、パネルの中で明るく浮くため）。標準外の疑似要素なので将来効かなくなりうるが、
  効かなくなっても既定のグレーに戻るだけで再生は壊れない。
  タイムラインの線・つまみ・アイコンの色には CSS が届かないので、そこは追わない。

## 2. diff の見せ方

画像の diff と**同じ枠**に乗せる。ラベル / 中身 / メタ情報の 3 段で、両側あるなら 2 カラム。

|  | 画像 | 音声 | 動画 |
| --- | --- | --- | --- |
| 中身 | `<img>` | `<audio controls>` | `<video controls>` |
| メタ情報 | `1920 × 1080 · 2.4 MB` | `1:32 · 2.4 MB` | `1280 × 720 · 0:14 · 8.4 MB` |

**比べるのはメタ情報**。長さが変わった・寸法が変わった・サイズが変わった、はここで読める。
中身そのものの比較は、両方を自分で再生する。

メタ情報の出どころは画像と同じ考え方で、**サイズは git から分かる値、長さと寸法は要素に読ませた値**。
画像が `<img>` の `naturalWidth` / `naturalHeight` を測っているのと同じ位置に、
`loadedmetadata` の `duration` と `videoWidth` / `videoHeight` が来る。

画像は両側の寸法を測ってから共通の箱に入れて倍率をそろえているが、**音声・動画ではそろえない**。
長さをそろえる意味は薄く、動画の寸法差はメタ情報で読めるので、要素の自然な大きさで置く。

片側だけのときは 1 面にして、画像と同じ Added / Deleted のラベルを付ける。

### before/after の枠は画像と共有する

いまこの枠は `.image-diff-columns` / `.image-side` / `.image-side-label` / `.image-side-meta` という
名前で、画像プレビューだけが使っている。音声・動画も同じ枠に乗るので、**画像に限らない名前へ変える**
（`.diff-side-columns` / `.diff-side` / `.diff-side-label` / `.diff-side-meta`）。
中身の描き方だけが画像・音声・動画で違い、枠は 1 つ。

画像専用の `.image-stage`（透過用のチェッカー柄）と `.image-layer` はそのまま画像に残す。

## 3. 中身の運び方

プレイヤーが要るのはバイト列ではなく **URL** なので、URL だけを渡す。
アプリの画面自体が `file:` オリジンなので、`<audio src="file:///…">` がそのまま読める。
Chromium が必要なぶんだけディスクから読むので、**アプリのメモリを 1 バイトも通らない**。

バイト列を渡す形（data URL や Blob URL）を採らない理由: 64 MB のファイル 1 つで、main の Buffer、
IPC のシリアライズ、renderer の配列、Blob のコピーが一時的に重なる。上限を置いて誤魔化すことになり、
上限は「そういう運び方をしている」こと以外に根拠がない。

問題は **元側（before）は作業ツリーに存在しない**こと（git の blob）。
ここだけは取り出す必要があるので、**blob OID をファイル名にして一時ディレクトリへ一度だけ書き出し**、
そのファイルを指す。OID は不変なので使い回せる。取り出しは `git cat-file blob <oid>` の出力を
そのままファイルへ流すので、こちらもメモリに溜めない。

この仕組みは音声・動画に限らないので、**画像も同じ道を通す**。画像はこれまで両側を data URL として
運んでいた（base64 で 4/3 に膨らんだ文字列が main と renderer の両方に残る）。
中身を URL で渡せるなら画像も同じでよく、`image-diff.ts` と分ける理由がなくなる。
IPC もプレビュー用の 1 本（`getPreviewDiffDocument`）にまとめる。

### URL に中身の識別子を載せる

作業ツリーのファイルは**中身が変わってもパスが変わらない**。Chromium は URL 全体でキャッシュするので、
そのままだと書き換えられても古い内容が表示され続ける（実機で確認した。`?v=1` のまま再取得すると
書き換え前の画像が返り、`?v=2` にすると新しい画像が返る）。

そこで URL に識別子をクエリとして付ける（git の blob は OID、作業ツリーのファイルはサイズと mtime）。
クエリはファイルの場所には影響しない。これで **URL が「どの中身か」を表す**ようになり、

- 中身が変われば URL が変わるので、要素が自動で読み直す（`load()` を明示的に呼ぶ必要がない）
- 両側が同じ内容かの判定が URL の比較で済む（識別子を別に持たなくてよい）

**取り出したファイルは自分では消さない。** OID が不変なので「古くなる」状態が存在せず、消す理由が
ディスクの節約しかない。置き場所が `$TMPDIR` なので、3 日触られなければ macOS 自身が消す
（`com.apple.bsd.dirhelper` が毎日 3:35 に走り、`CLEAN_FILES_OLDER_THAN_DAYS=3`。実機で、
サブディレクトリの中も含めて 30 日以上前のファイルが 0 件であることを確認した）。
起動時・終了時に自分で消す形にすると、**Yuru を 2 つ起動した時に互いのファイルを消し合う**。
既存の API socket の掃除も、pid で分けて生きているプロセスのものには触らないようにしている。

**専用 protocol（`yuru-media://`）にする案は採らない。**
`HtmlPreviewGrants` と同じ grant 方式にすれば Content-Type を自分で付けられるが、
grant の生存管理と Range の実装（RFC 9110 の byte range）が要る。
`file://` なら Chromium の file ローダがどちらもやる。
Content-Type を指定したくなった時（例: `.mov` を `video/mp4` として渡したい時）が、protocol に移る時。

## 4. 更新の追従

エージェントが書き換えた音声・動画に追いつく必要がある（例: 音を作り直して聴き直す）。
画像プレビューが 3 秒ごとに追従しているのと同じ理由・同じ間隔だが、**poll で運ぶのはメタデータだけ**にする。

### `loadDiffBuffers` を「どこから読むか」と「読む」に分ける

今の `loadDiffBuffers()` は scope（`base` / `staged` / `unstaged` / なし）の解釈と実際の読み取りを
まとめて持っている。ここを 2 段に割る。

```ts
// どちらの側が「どこ」にあるかだけを返す。null はその側にファイルが無いこと。
type DiffSource = { kind: "worktree" } | { kind: "index" } | { kind: "blob"; rev: string } | null;

resolveDiffSources(cwd, filePath, scope, reviewBase): { original: DiffSource; current: DiffSource }
readDiffSource(cwd, filePath, source): Promise<Buffer | null>          // 既存の読み取り
statDiffSource(cwd, filePath, source): Promise<DiffSourceStat | null>  // 中身を読まない
```

`loadDiffBuffers()` は `resolveDiffSources()` + `readDiffSource()` の組み合わせになる。
scope の解釈が 1 箇所に残るので、音声・動画側が scope を解釈し直すことはない。

`DiffSourceStat` は `{ byteLength, contentId }`。`contentId` は「中身が変わっていないこと」を
安く言い切るための識別子で、取り方は場所ごとに違う。

| 場所 | byteLength | contentId |
| --- | --- | --- |
| `blob` / `index` | `git cat-file -s <rev>:<path>` | blob OID（`git rev-parse <rev>:<path>` / `git ls-files -s`） |
| `worktree` | `fs.stat` の `size` | `size:mtimeMs`（git が index で使っているのと同じ stat ベースの判定） |

`contentId` はハッシュではないので**別の場所どうしでは比べない**。
「両側が同じ中身か」は git から導く。scope なしのときは今と同じく `isPathChanged()` で、
変更なしなら両側とも `{ kind: "worktree" }` になり、contentId が一致して 1 面になる。
scope 付きのときは git が差分として挙げた path なので、2 面で扱う。

mtime 依存の限界: 同じ mtime のまま中身が変わると取り逃す。poll は止まらないので、
次に mtime が動いた時点で追いつく。

### 再生中に差し替わったら

`contentId` が変わったら新しいバイト列を取り直し、`src` を差し替える。このとき
**`currentTime` と再生状態（再生中／停止中）を保つ**。新しい長さが短ければ末尾に丸める。

作り直した音を同じ場所から聴き直したい、が普通の流れなので、位置を 0 に戻すのは邪魔になる。
差し替わったことは、メタ情報の長さ・サイズが変わることで分かる。

## 5. 失敗時の挙動

| 起きること | 表示 |
| --- | --- |
| 取得中 | `Loading media…` |
| 拡張子が allowlist 外 | そもそもプレビューの種類にならない。今までどおり binary 扱い |
| 要素が `error` を出した（コーデック非対応・壊れている） | `This file cannot be played here` + サイズ |
| 片側が不在 | Added / Deleted として 1 面 |

コーデックの前提: Electron 43 の同梱 ffmpeg には H.264 / AAC / MP3 / FLAC / Opus / Vorbis / ALAC と
mp4・matroska の demuxer が入っている（`libffmpeg.dylib` で確認済み）。
ただし形式を決めるのは**拡張子から Chromium が判断する MIME** なので（`file://` では
こちらから指定できない）、**allowlist に載っていても再生できないことがある前提**で、
`error` からの fallback を仕様として持つ。

`.mov` は Chromium が `video/quicktime` を受け付けないため、再生できない可能性が高い。
それでも allowlist に残すのは、「再生できない」と出す方がバイナリ扱いで何も出ないより
分かりやすいから。Content-Type を付けて渡したくなったら protocol に移る。

### 対応する拡張子

| 種類 | 拡張子 |
| --- | --- |
| 音声 | `.mp3` `.wav` `.m4a` `.aac` `.flac` `.ogg` `.oga` `.opus` `.weba` |
| 動画 | `.mp4` `.m4v` `.mov` `.webm` `.ogv` |

## 6. 追加・変更するもの

| 場所 | 内容 |
| --- | --- |
| `src/shared/media-preview.ts` | `mediaPreviewKind(path)` → `"audio"` \| `"video"` \| `null`。`image-preview.ts` と同じ形 |
| `src/shared/image-preview.ts` | media type が不要になったので `isImagePath(path)` に変える |
| `src/shared/ipc.ts` | `PreviewDiffDocument` / `PreviewSide` と API 1 本（画像用の API は消える） |
| `src/main/git/diff.ts` | `loadDiffBuffers` を `resolveDiffSources` + `readDiffSource` + `statDiffSource` に割る |
| `src/main/exec.ts` | stdout をメモリに溜めずファイルへ流す `execToFile` |
| `src/main/preview/binary-preview.ts` | 画像・音声・動画のプレビュー用。`image-diff.ts` を置き換える |
| `src/main/service.ts` / `src/main/index.ts` / `src/preload/index.ts` | IPC 1 本の配線 |
| `src/renderer/preview/DiffPreviewPanel.tsx` | `renderedPreviewKind` に `"media"` を追加し、`MediaPreview` を lazy で出す |
| `src/renderer/preview/MediaPreview.tsx` | 2 面のレイアウトと、差し替え時の再生位置の引き継ぎ |
| `src/renderer/preview/ImagePreview.tsx` | data URL をやめて URL を使う。before/after の枠のクラス名を `.diff-side*` に変える |
| `src/renderer/utils/format.ts` | サイズと長さの表記。`ImagePreview` にあったサイズの表記をここへ出す |
| `src/main/files/files.ts` | 中身を読まずに stat だけ取る `statRegularFile` |
| `src/renderer/style.css` | `.image-*` の枠を `.diff-side*` に改名し、`.media-preview` を足す |

IPC:

```ts
// 画像・音声・動画で共通。poll はこれだけを叩く。
getPreviewDiffDocument(worktreeId, filePath, scope?): Result<PreviewDiffDocument | null>

interface PreviewSide { byteLength: number; url: string }
interface PreviewDiffDocument {
  path: string;
  original: PreviewSide | null;
  current: PreviewSide | null;
}
```

音声か動画かは path から分かる（`mediaPreviewKind`）ので、document には持たせない。

テスト:

- `test/main/preview/media-preview.test.mjs` — scope ごとの source 解決、片側不在、上限、
  worktree 外パス（`image-diff.test.mjs` と同じ並び）
- `test/e2e/media-preview.test.ts` — 小さな wav を fixture にして、プレビューが出て
  再生できるところまで。wav はヘッダを自分で組み立てれば生成できる

## 7. 採らなかった案

| 案 | 採らない理由 |
| --- | --- |
| 自前のトランスポート（再生・シーク・A/B を自分で描く） | 買えるのは「before/after で 1 本のタイムラインを共有すること」だけ。いま欲しいのは再生できること |
| 波形を出して音声の差を目で見せる | 同上。欲しくなればネイティブのコントロールを残したまま上に足せる |
| 2 つの要素の再生位置を JS で同期する | 同上。コントロールバーは 2 本のままなので、得るものが少ない |
| `::-webkit-media-controls-*` でタイムラインやアイコンまで見た目を寄せる | 地の色・外枠・一部のボタンの有無までしか CSS が届かない。タイムラインは外側の箱しか塗れず、塗ると壊れて見える |
| data URL / Blob URL（バイト列を渡す） | 中身がアプリのメモリを何本も通る。サイズの上限を置いて誤魔化すことになる |
| `yuru-media://` protocol | Content-Type を付けられるのが唯一の利点。`file://` なら Range も含めて Chromium の file ローダがやる |
| 画像だけ data URL のまま残す | 中身の運び方が 2 つになる。画像の方が使用頻度が高いので、メモリを使う側を残す理由がない |
| 3 秒ごとに中身ごと取り直す（画像と同じ poll） | 中身を運ばないので、そもそも運ぶものが無い。メタデータだけで済む |
| 再生できない時に既定アプリで開く | `shell.openExternal` は http/https だけに絞ってある。ローカルファイルを既定アプリに渡すのは別の判断が要る |

## 8. この作業の外で見つけたこと

`getGitDiffDocument()` は binary かどうかを判定するためにファイル全体を読んでいる
（`bufferToContent` が捨てる前に、もう読み終わっている）。300 MB の動画を開くと、
プレビューの中身とは別に、3 秒ごとに 300 MB を読むことになる。
音声・動画のプレビューを入れると目につきやすくなるが、原因は今の binary 判定にあるので別件。
