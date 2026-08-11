import type { PlanUsageWindow } from "../../../shared/session.js";
import type { PlanUsage } from "../agent.js";
import { withPlanUsageProcess } from "../plan-usage-io.js";
import type { ResolvedAgentCommand } from "../command.js";

const TIMEOUT_MS = 15_000;
// 起動時に標準出力へ出る URL。--port 0 を渡すと実際に割り当てられたポートがここに出る。
// token は初回起動時に kimi が自動生成して保存するもので、ユーザーの用意は要らない。
const SERVER_URL_PATTERN = /http:\/\/127\.0\.0\.1:(\d+)\/#token=([A-Za-z0-9_-]+)/;
const FIVE_HOUR_LABEL_PATTERN = /^(\d+)h limit$/;

// kimi はプランの利用状況を返す口をローカルサーバ側に持っている (`kimi web` が立てる
// REST の /oauth/usage)。その先は kimi 自身が OAuth トークンを付けて upstream を引く。
// モデルは動かず、セッションも作られない。
export async function loadKimiPlanUsage(command: ResolvedAgentCommand): Promise<PlanUsage> {
  return withPlanUsageProcess(
    command,
    ["web", "--no-open", "--port", "0", "--log-level", "error"],
    TIMEOUT_MS,
    async (child) => {
      const server = await readServerUrl(child.stdout);
      if (!(await isLoggedIn(server))) {
        return { state: "logged-out" };
      }
      const usage = await getJson(server, "/api/v1/oauth/usage");
      if (!isRecord(usage) || usage.kind !== "ok") {
        throw new Error(
          `kimi usage request failed: ${isRecord(usage) ? String(usage.message) : "unreadable response"}`,
        );
      }
      const fetchedAt = Date.now();
      return {
        state: "ok",
        fiveHour: toWindow(findFiveHourRow(usage.limits), fetchedAt),
        weekly: toWindow(usage.summary, fetchedAt),
      };
    },
  );
}

interface KimiServer {
  port: string;
  token: string;
}

function readServerUrl(stdout: NodeJS.ReadableStream): Promise<KimiServer> {
  return new Promise((resolve) => {
    let output = "";
    stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
      const match = SERVER_URL_PATTERN.exec(output);
      if (match) {
        resolve({ port: match[1], token: match[2] });
      }
    });
  });
}

async function isLoggedIn(server: KimiServer): Promise<boolean> {
  const auth = await getJson(server, "/api/v1/auth");
  if (!isRecord(auth) || !("managed_provider" in auth)) {
    throw new Error("kimi auth request did not report managed_provider");
  }
  // ログインしていないときだけ managed_provider が null になる。それ以外の形は
  // 応答が変わった可能性があるので、未ログインと決めつけず失敗として扱う。
  if (auth.managed_provider === null) {
    return false;
  }
  if (!isRecord(auth.managed_provider)) {
    throw new Error("kimi auth request returned an unreadable managed_provider");
  }
  return true;
}

// この REST は成否を HTTP ではなく本体の code / data で返す。
async function getJson(server: KimiServer, path: string): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
    headers: { Authorization: `Bearer ${server.token}` },
  });
  if (!response.ok) {
    throw new Error(`kimi ${path} responded with HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body)) {
    throw new Error(`kimi ${path} returned a non-object response`);
  }
  return body.data;
}

// 5 時間枠は limits[] に入るが、どの枠かを見分ける手掛かりは表示用の label しかない
// (kimi が upstream の窓の長さから "5h limit" のように組み立てている)。label から
// 長さを読めなければ、間違った数字を出すより枠が無いものとして扱う。
function findFiveHourRow(limits: unknown): unknown {
  if (!Array.isArray(limits)) {
    return null;
  }
  return (
    limits.find((row) => {
      if (!isRecord(row) || typeof row.label !== "string") {
        return false;
      }
      const match = FIVE_HOUR_LABEL_PATTERN.exec(row.label);
      return match !== null && Number(match[1]) === 5;
    }) ?? null
  );
}

function toWindow(raw: unknown, fetchedAt: number): PlanUsageWindow | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.used !== "number" || typeof raw.limit !== "number" || raw.limit <= 0) {
    throw new Error("kimi usage row has no usable used/limit");
  }
  return {
    usedPercent: (raw.used / raw.limit) * 100,
    resetsAt:
      typeof raw.reset_hint === "string" ? parseKimiResetHint(raw.reset_hint, fetchedAt) : null,
  };
}

// kimi はリセットを絶対時刻ではなく "resets in 6d 5h 28m" という表示用の文字列でしか
// 返さない。0 でない単位だけを空白区切りで並べる形 ("6d 5h 28m" / "2h 28m" / "12m" /
// "30s") と決まっているので、取得時刻に足して絶対時刻へ直す。リセット済みを表す
// "reset" や、解釈できない文字列は null にする (推測で時刻を作らない)。
export function parseKimiResetHint(hint: string, fetchedAt: number): number | null {
  const remaining = /^resets in (.+)$/.exec(hint);
  if (!remaining) {
    return null;
  }
  const parts = /^(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/.exec(remaining[1].trim());
  if (!parts || parts.slice(1).every((part) => part === undefined)) {
    return null;
  }
  const [days, hours, minutes, seconds] = parts
    .slice(1)
    .map((part) => (part === undefined ? 0 : Number(part)));
  return fetchedAt + ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
