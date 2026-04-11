# I6 Session Exit Visibility

Last updated: 2026-04-12

`I6` は、セッション終了時にだけ出るメッセージを、その場で読み取れるようにするための実装メモ。
対象は Codex に限らず、Claude を含む provider 共通の表示 UX とする。

## Goal

- セッション終了直前にだけ出る重要な案内を、Yuru 上でも見失いにくくする
- ただし、provider ごとの本来の挙動を Yuru が過剰に作り替えない

## Observed case

- Yuru 上で session を `Ctrl+C` で終了すると、provider が最後に usage や resume 方法を出すことがある
- しかし Yuru では session が inactive になると terminal が実質的に見えなくなり、その直前の数行を読む時間がない
- 例として Codex は終了時に次のような情報を出すことがある
  `Token usage: ...`
  `To continue this session, run codex resume <id>`
- `self-update` はこの問題が目立ちやすい具体例だが、本質は「終了時メッセージ全般」にある

## Problem statement

- 問題の中心は self-update ではなく、終了時エピローグの可視性不足
- この item では表示の問題だけを扱う
  - 終了後すぐに terminal が消え、最後の数行を読めない
  - inactive session を開き直しても、resume 前に buffer が消える可能性がある
- 後から見返せるか、Yuru が補助保存するかは `I7` として分ける

## Questions

- session 終了後も terminal buffer をそのまま残して読めるようにするべきか
- inactive session を開いたとき、resume 前に buffer を消さないほうがよいか
- 「終了した」ことの表示と、「再開方法」の表示を分けて考えるべきか

## Possible directions

- 終了後もしばらく buffer を保持する:
  inactive になっても terminal の最後の表示をそのまま見られるようにする
- inactive session の terminal を read-only に見せる:
  再開操作をするまでは、終了時点の画面をそのまま残す
- 終了直後だけ UI 上に小さく残す:
  session card や terminal header に「just exited」のような状態を出す

## Priority note

- 毎回起こる問題ではないが、終了直前の案内を失うと戸惑いやすい
- まずは表示保持だけで十分かを見たい
