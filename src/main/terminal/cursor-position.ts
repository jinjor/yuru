// TUI が送る CSI 6n / CSI ? 6n と、それに xterm が返す cursor position report は
// 画面内容の変化でもユーザー入力でもないため、activity 判定から除外する。
const ESCAPE_CHARACTER = String.fromCharCode(0x1b);
const CURSOR_POSITION_QUERY_PATTERN = new RegExp(`^(?:${ESCAPE_CHARACTER}\\[[?]?6n)+$`);
const CURSOR_POSITION_REPORT_PATTERN = new RegExp(`^(?:${ESCAPE_CHARACTER}\\[[?]?\\d+;\\d+R)+$`);

export function isCursorPositionQuery(data: string): boolean {
  return CURSOR_POSITION_QUERY_PATTERN.test(data);
}

export function isCursorPositionReport(data: string): boolean {
  return CURSOR_POSITION_REPORT_PATTERN.test(data);
}
