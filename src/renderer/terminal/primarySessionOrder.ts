// タブに出るのは runtime を持つ primary session だけなので、タブの並びをそのまま
// 全体 (ホーム) の並びにはできない。落とした場所の左隣のタブを目印にして、全体の並びでも
// そのタブの直後へ移す。左端に落とした時は目印がいないので全体の先頭へ移す。
// こうすると、タブで見えている session の相対順はドラッグしたとおりになり、動かした 1 件を
// 除いて、タブに出ていない session の相対順も変わらない。
export function toPrimarySessionOrder(
  primarySessionKeys: readonly string[],
  tabKeys: readonly string[],
  movedKey: string,
): string[] {
  const leftTabKey = tabKeys[tabKeys.indexOf(movedKey) - 1];
  const rest = primarySessionKeys.filter((key) => key !== movedKey);
  const insertAt = leftTabKey === undefined ? 0 : rest.indexOf(leftTabKey) + 1;
  return [...rest.slice(0, insertAt), movedKey, ...rest.slice(insertAt)];
}
