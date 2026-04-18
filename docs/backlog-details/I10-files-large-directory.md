# I10 Files Large Directory

## Goal

自前 tree に切り替えた後で、大量のファイルを表示した時に実用上問題ない速度を保てるか確認し、必要なら重さ対策を入れる。

## Why now

`react-arborist` は Yuru の Files ツリーには少しオーバースペックに見えるので、自前 tree への切り替え自体は進めたい。
ただし、巨大な directory を開いた時に仮想化がなくても十分かは別途見たい。
切り替え後に実測して、必要な対策だけ足したい。

## Observations

- 普段のコード閲覧では、同じ階層に極端に多くの file が並ぶことは少なそう
- monorepo でも、通常は階層化されていて一度に見る兄弟 node 数は限られるはず
- ただし `node_modules`、生成物、ログ置き場などでは大量 entry がありうる
- 今の Yuru では編集機能や強い keyboard 操作はなく、tree library の機能をかなり持て余している
- なので tree library を残す理由は主に仮想化だが、それは自前 tree に切り替えた後でも必要かを見極めたい

## Questions

- 実際にどのくらいの entry 数で体感が悪くなるか
- 重さの本体が DOM 行数なのか、tree state 管理なのか
- 自前 tree でどこまで問題なく使えるか
- 対策が必要ならどこまでで十分か

## Possible directions

- まずは自前 tree に切り替えた状態で巨大 directory を実測する
- 問題が小さければ、そのまま様子を見る
- 問題が大きければ、巨大 directory 対策を足す
- 候補として `100件ずつ more...` のような段階表示を検討する
