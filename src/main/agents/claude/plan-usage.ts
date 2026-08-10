import type { PlanUsageWindow } from "../../../shared/session.js";
import type { PlanUsage } from "../../agent.js";
import { readJsonLines, runPlanUsageCommand, withPlanUsageProcess } from "../../plan-usage-io.js";
import type { ResolvedProviderCommand } from "../../provider-command.js";

const REQUEST_ID = "yuru-plan-usage";
const TIMEOUT_MS = 10_000;

// Claude はプランの利用状況を SDK の control request `get_usage` で返す。これは
// モデルを呼ばず `GET /api/oauth/usage` を引くだけなので、セッションが動いていなくても
// 最新値が取れ、トークンも消費しない。--safe-mode でユーザーの hooks / plugins /
// CLAUDE.md を読ませず、ユーザーメッセージを送らないので transcript も残らない。
//
// get_usage は Claude Code 側で experimental (応答の形が変わりうる) と明記されている。
// 知っている形でなければ例外にして「取れなかった」に倒す。未ログインと取り違えて
// 黙って表示すると、ユーザーは再ログインしても直らない原因不明の状態に置かれる。
export async function loadClaudePlanUsage(command: ResolvedProviderCommand): Promise<PlanUsage> {
  const usage = await requestUsage(command);
  if (!isRecord(usage) || typeof usage.rate_limits_available !== "boolean") {
    throw new Error("claude get_usage did not report rate_limits_available");
  }
  // rate_limits_available が false のときは rate_limits も null になる。これは
  // 「未ログイン」と「API キーなどでプランのリミットが適用されない」の両方を含むので、
  // ここでだけログイン状態を聞いて分ける。
  if (!usage.rate_limits_available) {
    return (await isLoggedIn(command)) ? { state: "no-plan-limits" } : { state: "logged-out" };
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

async function requestUsage(command: ResolvedProviderCommand): Promise<unknown> {
  return withPlanUsageProcess(
    command,
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

async function isLoggedIn(command: ResolvedProviderCommand): Promise<boolean> {
  const status: unknown = JSON.parse(
    await runPlanUsageCommand(command, ["auth", "status", "--json"], TIMEOUT_MS),
  );
  if (!isRecord(status) || typeof status.loggedIn !== "boolean") {
    throw new Error("claude auth status did not report loggedIn");
  }
  return status.loggedIn;
}

function toWindow(raw: unknown): PlanUsageWindow | null {
  // その枠を返さないときは null が入る。Claude は 5 時間枠と週枠の両方を返すが、
  // 枠の有無は provider 側の都合なので、無い形も受け入れる。
  if (raw === null || raw === undefined) {
    return null;
  }
  if (!isRecord(raw) || typeof raw.utilization !== "number") {
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
