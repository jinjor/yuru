import type { RateLimitStopMark } from "../rate-limit-stop.js";

// rollout には、断られたリクエストが turn の終了 (task_complete) に付く error として
// 残る。種別は本文ではなく codex_error_info で見分ける。task_complete は断られなくても
// 書かれるので、会話が進んだ印は次の turn の開始 (task_started) だけを数える。
export function classifyCodexRolloutLine(line: string): RateLimitStopMark | null {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(entry) || entry.type !== "event_msg" || !isRecord(entry.payload)) {
    return null;
  }
  const payload = entry.payload;
  if (
    payload.type === "task_complete" &&
    isRecord(payload.error) &&
    payload.error.codex_error_info === "usage_limit_exceeded"
  ) {
    return "stopped";
  }
  return payload.type === "task_started" ? "moved-on" : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
