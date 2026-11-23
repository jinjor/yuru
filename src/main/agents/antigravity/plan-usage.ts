import type { PlanUsageWindow } from "../../../shared/session.js";
import type { PlanUsage } from "../agent.js";
import type { ResolvedAgentCommand } from "../command.js";
import { runPlanUsageCommand } from "../plan-usage-io.js";

const TIMEOUT_MS = 15_000;
const GEMINI_BUCKET_IDS = new Set(["gemini-5h", "gemini-weekly"]);
const GEMINI_GROUP_NAME = "Gemini Models";

// agy exposes account quota via `agy --print /usage --output-format json`.
// It queries the backend without invoking a model, consuming tokens, or
// creating a conversation.
//
// Antigravity reports separate quota groups (Gemini Models, Claude and GPT
// models, Gemini 4 Argon). Yuru currently displays one 5h/7d pair per
// provider, so we pick the primary Gemini Models group here.
export async function loadAntigravityPlanUsage(command: ResolvedAgentCommand): Promise<PlanUsage> {
  const raw = await runPlanUsageCommand(
    command,
    ["--print", "/usage", "--output-format", "json"],
    TIMEOUT_MS,
  );
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("agy /usage did not return valid JSON");
  }
  if (!isRecord(payload)) {
    throw new Error("agy /usage returned a non-object response");
  }
  if (payload.status !== "SUCCESS") {
    throw new Error(`agy /usage failed with status ${String(payload.status)}`);
  }
  const commandPayload = payload.command;
  if (!isRecord(commandPayload) || commandPayload.name !== "usage") {
    throw new Error("agy /usage response is missing command.usage payload");
  }
  const data = commandPayload.data;
  if (!isRecord(data) || !Array.isArray(data.groups)) {
    throw new Error("agy /usage response has no quota groups");
  }
  if (data.groups.length === 0) {
    return { state: "no-plan-limits" };
  }

  const group = findGeminiGroup(data.groups);
  if (!group) {
    throw new Error("agy /usage response does not contain a Gemini quota group");
  }

  return {
    state: "ok",
    fiveHour: findBucketWindow(group.buckets, "5h"),
    weekly: findBucketWindow(group.buckets, "weekly"),
  };
}

interface QuotaGroup {
  name: string;
  buckets: unknown[];
}

function findGeminiGroup(groups: readonly unknown[]): QuotaGroup | null {
  const parsedGroups = groups.flatMap((group) => {
    if (!isRecord(group) || typeof group.name !== "string" || !Array.isArray(group.buckets)) {
      return [];
    }
    return [{ name: group.name, buckets: group.buckets }];
  });

  // Prefer matching by known Gemini bucket IDs so minor display-name changes do
  // not break parsing; fall back to the group display name.
  return (
    parsedGroups.find((group) =>
      group.buckets.some(
        (bucket) =>
          isRecord(bucket) && typeof bucket.id === "string" && GEMINI_BUCKET_IDS.has(bucket.id),
      ),
    ) ??
    parsedGroups.find((group) => group.name === GEMINI_GROUP_NAME) ??
    null
  );
}

function findBucketWindow(buckets: readonly unknown[], window: string): PlanUsageWindow | null {
  for (const bucket of buckets) {
    if (!isRecord(bucket) || bucket.window !== window) {
      continue;
    }
    if (
      typeof bucket.remaining_fraction !== "number" ||
      !Number.isFinite(bucket.remaining_fraction)
    ) {
      throw new Error(`agy /usage ${window} bucket has no remaining_fraction`);
    }
    return {
      usedPercent: clampPercent((1 - bucket.remaining_fraction) * 100),
      resetsAt: typeof bucket.reset_time === "string" ? toEpochMs(bucket.reset_time) : null,
    };
  }
  return null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function toEpochMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
