# B12 Claude の resume で worktree の作業指示が引き継がれない

Last updated: 2026-07-28

`B12` は、Yuru が resume した Claude セッションで、Claude が task worktree ではなく
repo root を作業場所だと思い込む不具合のメモ。
調査時点の記録であり、以後メンテはしない。

## 症状

task worktree に紐づく Claude セッションを resume すると、Claude が repo root を作業場所として扱う。
ファイルの読み書き・ビルド・テストが worktree の外で行われうる。

## 何が起きているか

Yuru は新規セッションを repo root で起動する（セッションの保存先を安定させるため）。
そのうえで「作業は worktree で行え」という指示 (`worktree-context-prompt.ts`) を
**起動時引数**として渡し、cwd と実際の作業場所のズレを埋めている。

- claude: `--append-system-prompt <prompt>`
- codex: `-c developer_instructions=<prompt>`
- kimi: 通常の user message (`initialInput`)

各 provider の保存方法は異なる。

- Claude の `--append-system-prompt` は session に保存されない。resume 経路
  (`createResumeLaunch`) でも再指定していないため、再開したセッションから指示が消える。
- Codex の `developer_instructions` は developer message として rollout に保存される。
  resume 時に `-c` を再指定しなくても、保存された指示が model context に復元される。
- kimi は指示を通常の user message として保存するため、resume 後の会話履歴にも残る。

したがって、cwd が repo root のままなのに worktree の指示だけを失うのは Claude である。
Codex と kimi は resume 時に指示を再注入していないが、保存済み session から復元されるため
同じ問題は起きない。

## 確認方法

2026-07-28 に次の対照実験を行った。

- Claude Code 2.1.220
  - 固有 token を `--append-system-prompt` で渡して session を作成した。
  - 保存された session JSONL に token はなく、追加指定なしの resume 後も Claude は token を
    参照できなかった。
  - resume 時に同じ `--append-system-prompt` を指定すると token を参照できた。
- Codex CLI 0.145.0
  - 固有 marker を `-c developer_instructions=...` で渡して session を作成した。
  - marker は rollout JSONL の developer message に保存されていた。
  - `-c` を指定せず resume しても marker の指示に従った。

## Claude で顕在化する条件

resume 前に worktree 内で作業していれば、会話履歴にそのパスが残るので、
Claude は指示が無くても作業場所を履歴から推測できる。
今回顕在化したのは **resume 前に何も作業していなかった**セッションで、
履歴に手がかりが無かったため。この意味では例外的なケース。

## 修正の方向性（決め打ちしない）

resume 時に同じ指示をそのまま再注入するのは適切でない。
作業する worktree を途中で切り替えることがあり、
古い worktree を指す指示が戻ってくると、切り替えた先の作業を邪魔する。

- 起動時に固定するのではなく、現在紐づいている worktree に追従する渡し方にする
- 起動時引数に依存しない形（履歴に残る形）で渡すことも選択肢だが、
  会話が長くなるほど埋もれる点は kimi と同じ弱さを持つ
- 対象は Claude に限定する。Codex と kimi には resume 時の再注入を追加しない
