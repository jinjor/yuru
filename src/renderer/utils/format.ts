// プレビューのメタ情報に出すファイルサイズ。
export function formatBytes(byteLength: number): string {
  if (byteLength < 1024) {
    return `${byteLength} B`;
  }
  if (byteLength < 1024 * 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`;
  }
  return `${(byteLength / 1024 / 1024).toFixed(1)} MB`;
}

// 音声・動画の長さ。1 時間以上は h:mm:ss、それ未満は m:ss。
export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const paddedSeconds = String(total % 60).padStart(2, "0");
  if (minutes < 60) {
    return `${minutes}:${paddedSeconds}`;
  }
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${paddedSeconds}`;
}

const relativeTimeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// 大きい単位から順に、1 以上になる最初の単位で表す。月と年は平均の長さで近似する。
const relativeTimeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * DAY_MS],
  ["month", 30 * DAY_MS],
  ["week", 7 * DAY_MS],
  ["day", DAY_MS],
  ["hour", HOUR_MS],
  ["minute", MINUTE_MS],
];

// 「3 days ago」のような、過去の時刻の相対表記。1 分未満は「now」。
export function formatRelativeTime(epochMs: number, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - epochMs);
  for (const [unit, unitMs] of relativeTimeUnits) {
    if (elapsedMs >= unitMs) {
      return relativeTimeFormat.format(-Math.floor(elapsedMs / unitMs), unit);
    }
  }
  return relativeTimeFormat.format(0, "second");
}
