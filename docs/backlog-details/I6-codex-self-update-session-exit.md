# I6 Codex Self-Update Session Exit

Last updated: 2026-04-12

`I6` は、Codex の self-update 後にセッションがどう見えるべきかの実装メモ。
前提は「Codex が update のために一度終了すること自体は異常とは限らない」。

## Goal

- Codex self-update 後の挙動を、Yuru 内でも違和感の少ない形にする
- ただし、通常の terminal と不自然に食い違う特別扱いは避ける

## Observed case

- Yuru 上で Codex を使っているときに update がある旨の案内が出た
- 選択肢を押すと `pnpm install -g @openai/codex` のような文字列が見えた
- その後 Codex プロセスが終了し、セッションが消えたように見えた

## Important assumption

- Yuru 外の普通の terminal でも、self-update 後に Codex が終了したなら、その terminal には特に何も表示されず終わる可能性がある
- その場合、Yuru だけが独自の自動復帰や特別メッセージを出すと、かえって一貫性を崩すかもしれない

## Questions

- self-update 後の Codex は、通常の terminal では実際にどう終わるのか
- Yuru ではセッションを「消えた」と感じにくくする最低限の表示が必要か
- 何もしないのが正しいのか、終了済みであることだけ残すのが正しいのか
- 自動再開はやりすぎか

## Possible directions

- 何もしない:
  普通の terminal と同じなら、そのまま終了として扱う
- 終了済みであることだけ残す:
  セッションカードや terminal 側で「Codex exited after update」のような最低限の痕跡を残す
- 再開導線だけ出す:
  自動再開ではなく、手動 resume の導線だけ用意する

## Priority note

- 日常的に起こることではないので、優先度は低い
- まずは事実確認と期待挙動の決定が先
