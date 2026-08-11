// リセットまでの残り時間は絶対時刻から毎描画で出す。フォーカスが外れて取得が
// 止まっている間も表示がズレないようにするため。
export function formatRemaining(remainingMs: number): string {
  const totalMinutes = Math.floor(remainingMs / 60_000);
  if (totalMinutes < 1) {
    return "<1m";
  }
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  // 狭い sidebar に収めるため上位 2 単位までにする。
  if (days > 0) {
    return `${days}d${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h${minutes}m`;
  }
  return `${minutes}m`;
}
