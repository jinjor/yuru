import type { RateLimitStopMark } from "../rate-limit-stop.js";

// rollout には、断られたリクエストが event_msg のエラーとして残る。種別は本文では
// なく codex_error_info で見分ける。エラーの直後には必ず task_complete が書かれる
// ので、会話が進んだ印は次の turn の開始 (task_started) だけを数える。
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
  if (payload.type === "error" && payload.codex_error_info === "usage_limit_exceeded") {
    return "stopped";
  }
  return payload.type === "task_started" ? "moved-on" : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
