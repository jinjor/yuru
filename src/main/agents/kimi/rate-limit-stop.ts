import type { RateLimitStopMark } from "../rate-limit-stop.js";

// kimi は断られたリクエストをセッションの記録本体には残さず、セッションごとの
// ログにだけ書く。判定には本文ではなく statusCode を使う。サブエージェントの失敗は
// 本体が止まったことを意味しないので数えない。
export function classifyKimiSessionLogLine(line: string): RateLimitStopMark | null {
  if (line.includes(" agentId=")) {
    return null;
  }
  if (line.includes(" statusCode=403")) {
    return "stopped";
  }
  // 断られた行は WARN の "llm request failed" なので、INFO の開始行とは重ならない。
  return /\sINFO\s+llm request\s/.test(line) ? "moved-on" : null;
}
