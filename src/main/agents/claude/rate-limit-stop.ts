import type { RateLimitStopMark } from "../rate-limit-stop.js";

// transcript には、断られたリクエストが model "<synthetic>" の assistant メッセージ
// として残る。種別は本文ではなく error と apiErrorStatus で見分ける。
export function classifyClaudeTranscriptLine(line: string): RateLimitStopMark | null {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(entry)) {
    return null;
  }
  if (
    entry.isApiErrorMessage === true &&
    entry.error === "rate_limit" &&
    entry.apiErrorStatus === 429
  ) {
    return "stopped";
  }
  // 会話そのものが進んだ印だけを数える。turn_duration や last-prompt のような
  // 記録用エントリは断られた直後にも書かれるので、印にしない。
  if (
    (entry.type === "user" || entry.type === "assistant") &&
    typeof entry.timestamp === "string"
  ) {
    return "moved-on";
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
