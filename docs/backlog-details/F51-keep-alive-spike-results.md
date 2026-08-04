# F51 Step 0 スパイク結果: keep-alive + Activity

Last updated: 2026-08-04

F51-worktree-keep-alive.md の Step 0 として 2026-08-03 に実施したスパイクの記録。
検証対象は F51-keep-alive-open-issues.md の課題 6〜9・13。

macOS 26.3 (arm64) の実 Electron BrowserWindow で、SessionView を worktree ごとの
Activity に入れた使い捨て実装を Playwright から操作した。

## 総合判定

| 課題 | 判定 | 実装方針への意味 |
|---|---|---|
| 6. Activity の実挙動 | ポジティブ | Activity 案を妨げる挙動はなく、追加の CSS コンテナも不要 |
| 7. xterm / IME | 保留 | xterm と composition は問題なし。macOS native IME の手動確認が残る |
| 8. lazy + Suspense | ポジティブ | 追加対応は不要 |
| 9. scroll 位置 | ポジティブ (想定どおり) | 非保持だが期待値の対象外なので問題なし |
| 13. hidden instance の再描画コスト | ポジティブ | Step 1 の参照保存 + memo が有効 |

## 詳細結果

### 課題 6 に対する結果: Activity の実挙動

**判定: ポジティブ。** Activity 案を妨げる挙動は見つからず、追加の CSS コンテナも不要。

- **cleanup と effect 再実行**: visible → hidden で計測用 effect の cleanup が 1 回走り、
  visible に戻すと同じ instance の effect 実行回数が 1 → 2 になった
- **DOM / state の保持**: SessionView の DOM node に付けた marker が往復後も残り、
  Files タブ、開いていた preview、CodeMirror の編集内容も保持された
- **fragment と layout**: fragment が返す `.session-view-column`、resize handle、
  `.changes-panel` は hidden 中すべて computed `display: none` になった。visible な
  column / explorer は各 1、`.app` の `scrollWidth === clientWidth` で flex layout は
  崩れなかった。SessionView を単一コンテナで包む CSS 調整は不要
- **hidden 更新の優先度**: development React に重い hidden subtree への更新を連続投入すると
  coalesce された。40 回の burst の 1 秒後には 3 instance が各 1 render にまとまり、
  30 秒待っても全 instance が 40 回すべてを実行する状態にはならなかった

### 課題 7 に対する結果: xterm / IME

**判定: 保留。** xterm の再生成・復元と Chromium の composition 経路はポジティブだが、
macOS native IME が未確認なので、課題 7 全体の判定はまだ確定できない。

- **dispose と再生成**: hidden 前の xterm DOM に付けた marker は復帰後に消え、別 DOM として
  再生成された
- **headless xterm からの復元**: hidden 前に実行した `F51_BEFORE_HIDE` の出力が復帰後の
  xterm に現れ、scrollback の復元を確認できた
- **xterm の composition 経路**: Chromium の `Input.imeSetComposition` で変換中文字列を
  表示し、Unicode の確定入力を PTY へ送る確認は、xterm 再生成の前後とも通った
- **未確認事項**: macOS 日本語 IME からのキー送信は、System Events が
  `osascriptにはキー操作の送信は許可されません` (error 1002) で拒否した。
  Accessibility 権限不足のため、`にほんご` → `日本語` の変換・確定を再生成前後に行う
  native IME の手動確認だけが残る

### 課題 8 に対する結果: lazy + Suspense

**判定: ポジティブ。** 3 種類とも復帰後に壊れず、Activity 案への追加対応は不要。

3 種類を別 worktree で開いて hidden / visible を往復した。

- MarkdownPreview は内容と preview mode を保持した
- HtmlPreview は復帰後に iframe を再接続し、内部 DOM の内容を再び読めた
- EditModeEditor は CodeMirror の編集内容を保持し、復帰後も表示・編集できた
- 復帰時に Suspense エラーや blank 表示は起きなかった

### 課題 9 に対する結果: scroll 位置

**判定: ポジティブ (想定どおり)。** scroll 位置は保持されなかったが、もともと期待値の
対象外であり、既存の「最初の変更行を表示する」挙動へ戻るため実装上の問題はない。

500 行の SourceViewer を末尾 (`scrollTop = 9187`) まで動かして往復すると、復帰後は
最初の変更行付近 (`scrollTop = 4555.5`) へ移動した。復帰時に effect が再実行され、
既存の「最初の変更行を表示する」処理が走るため。設計どおり保持を期待値に入れない。

### 課題 13 に対する結果: hidden instance の再描画コスト

**判定: ポジティブ。** 想定していた再描画コストは実在したが、Step 1 の
参照保存 + memo で無関係な instance の再描画を止められ、対策方針の有効性を確認できた。

5 repo の main standalone terminal runtime を起動し、各 SessionView で 600 行すべてが
変更された TypeScript diff を開いた。session push と同じ props 更新形状を一時的に App から
流し、renderer process の `ps %cpu` と render counter を採った。単一マシン・単一試行の
絶対値であり、比較の目安に限る。

production build、40 push / 25 ms、burst 中 100 ms 間隔 12 sample:

| | Step 1 なし (全 worktree を clone、memo なし) | Step 1 相当 (対象だけ clone + memo) |
|---|---:|---:|
| SessionView render 回数 | 41 / 40 / 40 / 40 / 40 | 41 / 0 / 0 / 0 / 0 |
| renderer CPU 平均 | 70.3% | 15.2% |
| renderer CPU 最大 | 98.5% | 20.2% |

平均 CPU は 78% 減った。Activity の低優先度化だけでは production のこの負荷で hidden
4 instance も各 push ごとに render しており、参照保存 + memo が必要という設計判断を
裏付ける。

production React は Profiler callback を無効化するため、描画時間だけ development React で
追加計測した。diff 自身の 3 秒 polling は初回取得後に止め、session push の影響だけに分離。
Activity の内側に置いた Profiler は hidden subtree の callback を報告しなかったため、
Activity 列全体を外側の Profiler で囲んだ。20 push / 100 ms の結果:

| | Step 1 なし | Step 1 相当 |
|---|---:|---:|
| SessionView render 回数 | 21 / 20 / 17 / 17 / 17 | 21 / 0 / 0 / 0 / 0 |
| 外側 Profiler の actualDuration 合計 | 613.6 ms | 517.6 ms |
| renderer CPU 平均 | 120.1% | 60.4% |

actualDuration は 16% 減、development build の平均 CPU は 50% 減。hidden 更新は
coalesce されるため commit 数は単純比較できないが、render counter は無関係な 4 instance の
再描画が対策後に 0 になることを直接示した。CI には絶対時間でなく、設計済みの render counter
不変条件だけを入れる。
