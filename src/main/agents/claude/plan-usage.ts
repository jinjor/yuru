import os from "os";
import type { PlanUsageWindow } from "../../../shared/session.js";
import type { PlanUsage } from "../../agent.js";
import { exec } from "../../exec.js";
import { readJsonLines, withPlanUsageProcess } from "../../plan-usage-io.js";

const REQUEST_ID = "yuru-plan-usage";
const TIMEOUT_MS = 10_000;

// Claude はプランの利用状況を SDK の control request `get_usage` で返す。これは
// モデルを呼ばず `GET /api/oauth/usage` を引くだけなので、セッションが動いていなくても
// 最新値が取れ、トークンも消費しない。--safe-mode でユーザーの hooks / plugins /
// CLAUDE.md を読ませず、ユーザーメッセージを送らないので transcript も残らない。
//
// get_usage は Claude Code 側で experimental (応答の形が変わりうる) と明記されている。
// 形が変わったら例外にして「取れなかった」に倒す。
export async function loadClaudePlanUsage(commandPath: string): Promise<PlanUsage> {
  const usage = await requestUsage(commandPath);
  if (!isRecord(usage)) {
    throw new Error("claude get_usage returned a non-object response");
  }
  // rate_limits_available が false のときは rate_limits も null になる。これは
  // 「未ログイン」と「API キーなどでプランのリミットが適用されない」の両方を含むので、
  // ここでだけログイン状態を聞いて分ける。
  if (usage.rate_limits_available !== true) {
    return (await isLoggedIn(commandPath)) ? { state: "no-plan-limits" } : { state: "logged-out" };
  }
  const rateLimits = usage.rate_limits;
  if (!isRecord(rateLimits)) {
    throw new Error("claude get_usage reported available rate limits without a body");
  }
  return {
    state: "ok",
    fiveHour: toWindow(rateLimits.five_hour),
    weekly: toWindow(rateLimits.seven_day),
  };
}

async function requestUsage(commandPath: string): Promise<unknown> {
  return withPlanUsageProcess(
    commandPath,
    [
      "--print",
      "--safe-mode",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
    ],
    TIMEOUT_MS,
    (child) =>
      new Promise<unknown>((resolve, reject) => {
        readJsonLines(
          child.stdout,
          (message) => {
            if (!isRecord(message) || message.type !== "control_response") {
              return;
            }
            const response = message.response;
            if (!isRecord(response) || response.request_id !== REQUEST_ID) {
              return;
            }
            if (response.subtype !== "success") {
              reject(new Error(`claude get_usage failed: ${String(response.error)}`));
              return;
            }
            resolve(response.response);
          },
          reject,
        );
        child.stdin.write(
          `${JSON.stringify({
            type: "control_request",
            request_id: REQUEST_ID,
            request: { subtype: "get_usage" },
          })}\n`,
        );
      }),
  );
}

async function isLoggedIn(commandPath: string): Promise<boolean> {
  const status: unknown = JSON.parse(
    await exec(commandPath, ["auth", "status", "--json"], os.tmpdir()),
  );
  if (!isRecord(status) || typeof status.loggedIn !== "boolean") {
    throw new Error("claude auth status did not report loggedIn");
  }
  return status.loggedIn;
}

function toWindow(raw: unknown): PlanUsageWindow | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.utilization !== "number") {
    throw new Error("claude rate limit window has no utilization");
  }
  return {
    usedPercent: raw.utilization,
    resetsAt: typeof raw.resets_at === "string" ? toEpochMs(raw.resets_at) : null,
  };
}

function toEpochMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
