import type { Readable, Writable } from "stream";
import type { PlanUsageWindow } from "../../../shared/session.js";
import type { PlanUsage } from "../../agent.js";
import { readJsonLines, withPlanUsageProcess } from "../../plan-usage-io.js";

const TIMEOUT_MS = 10_000;
const FIVE_HOUR_WINDOW_MINS = 300;
const WEEKLY_WINDOW_MINS = 10080;

// Codex は app-server (stdio の JSON-RPC) にプランの利用状況を聞く口を持っている。
// スレッドを作らないのでモデルは動かず、rollout ファイルも session_index も増えない。
// app-server は Codex 側で experimental 扱い。
export async function loadCodexPlanUsage(commandPath: string): Promise<PlanUsage> {
  return withPlanUsageProcess(commandPath, ["app-server"], TIMEOUT_MS, async (child) => {
    const connection = new AppServerConnection(child.stdin, child.stdout);
    await connection.request("initialize", {
      clientInfo: { name: "yuru", version: "0" },
    });
    // 未ログインだと account/rateLimits/read はエラーを返す。エラー文言に頼らず、
    // 先にアカウントの有無を聞いて「ログインしていないだけ」を切り分ける。
    const account = await connection.request("account/read", {});
    if (!isRecord(account) || account.account === null || account.account === undefined) {
      return { state: "logged-out" };
    }
    const rateLimits = await connection.request("account/rateLimits/read", null);
    if (!isRecord(rateLimits) || !isRecord(rateLimits.rateLimits)) {
      throw new Error("codex account/rateLimits/read returned no rateLimits");
    }
    // Codex は枠を primary / secondary という順序で返し、どちらがどの長さかは
    // windowDurationMins でしか分からない (2026-08 時点では週枠しか返らない)。
    const windows = [rateLimits.rateLimits.primary, rateLimits.rateLimits.secondary];
    return {
      state: "ok",
      fiveHour: findWindow(windows, FIVE_HOUR_WINDOW_MINS),
      weekly: findWindow(windows, WEEKLY_WINDOW_MINS),
    };
  });
}

function findWindow(windows: readonly unknown[], windowMins: number): PlanUsageWindow | null {
  for (const window of windows) {
    if (!isRecord(window) || window.windowDurationMins !== windowMins) {
      continue;
    }
    if (typeof window.usedPercent !== "number") {
      throw new Error("codex rate limit window has no usedPercent");
    }
    return {
      usedPercent: window.usedPercent,
      // resetsAt は Unix 秒。
      resetsAt: typeof window.resetsAt === "number" ? window.resetsAt * 1000 : null,
    };
  }
  return null;
}

class AppServerConnection {
  private readonly stdin: Writable;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  private failure: Error | null = null;

  constructor(stdin: Writable, stdout: Readable) {
    this.stdin = stdin;
    readJsonLines(
      stdout,
      (message) => {
        this.receive(message);
      },
      (error) => {
        this.fail(error);
      },
    );
  }

  async request(method: string, params: unknown): Promise<unknown> {
    if (this.failure) {
      throw this.failure;
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private receive(message: unknown): void {
    if (!isRecord(message) || typeof message.id !== "number") {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    if (isRecord(message.error)) {
      pending.reject(new Error(`codex app-server: ${String(message.error.message)}`));
      return;
    }
    pending.resolve(message.result);
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
