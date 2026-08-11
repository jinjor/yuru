import assert from "node:assert/strict";
import test from "node:test";

import { clearErrorNotices, listErrorNotices } from "../../../src/main/errors/center.ts";
import { PlanUsageMonitor } from "../../../src/main/agents/plan-usage-monitor.ts";

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

const allProviders = [
  { provider: "claude", command: "claude" },
  { provider: "codex", command: "codex" },
  { provider: "kimi", command: "kimi" },
];

function createMonitor(overrides = {}) {
  const pushed = [];
  const monitor = new PlanUsageMonitor({
    listProviders: () => allProviders,
    resolveCommandPaths: async (commands) =>
      new Map(
        commands.map((command) => [
          command,
          { path: `/bin/${command}`, pathEnv: "/bin:/usr/bin" },
        ]),
      ),
    loadPlanUsage: async () => ({ state: "ok", fiveHour: null, weekly: null }),
    planUsageChanged: (usages) => pushed.push(usages),
    ...overrides,
  });
  return { monitor, pushed };
}

test("解決できなかった provider は結果に現れない", async () => {
  clearErrorNotices();
  const { monitor, pushed } = createMonitor({
    resolveCommandPaths: async () =>
      new Map([["claude", { path: "/bin/claude", pathEnv: "/bin:/usr/bin" }]]),
  });
  monitor.start();
  monitor.stop();
  await flush();

  assert.equal(pushed.length, 1);
  assert.deepEqual(
    pushed[0].map((usage) => usage.provider),
    ["claude"],
  );
});

test("未ログインとプラン外はエラーにせずそのまま状態として返す", async () => {
  clearErrorNotices();
  const states = { claude: "logged-out", codex: "no-plan-limits", kimi: "ok" };
  const { monitor, pushed } = createMonitor({
    loadPlanUsage: async (provider) =>
      states[provider] === "ok"
        ? { state: "ok", fiveHour: { usedPercent: 50, resetsAt: 1000 }, weekly: null }
        : { state: states[provider] },
  });
  monitor.start();
  monitor.stop();
  await flush();

  assert.deepEqual(
    pushed[0].map((usage) => [usage.provider, usage.state]),
    [
      ["claude", "logged-out"],
      ["codex", "no-plan-limits"],
      ["kimi", "ok"],
    ],
  );
  assert.equal(listErrorNotices().length, 0);
});

test("想定外の失敗は failed として返し error center に記録する", async () => {
  clearErrorNotices();
  const { monitor, pushed } = createMonitor({
    loadPlanUsage: async (provider) => {
      if (provider === "codex") {
        throw new Error("app-server exploded");
      }
      return { state: "ok", fiveHour: null, weekly: null };
    },
  });
  monitor.start();
  monitor.stop();
  await flush();

  const codex = pushed[0].find((usage) => usage.provider === "codex");
  assert.equal(codex.state, "failed");
  const notices = listErrorNotices();
  assert.equal(notices.length, 1);
  assert.match(notices[0].detail ?? notices[0].message, /app-server exploded/);
});

test("コマンド解決に失敗した tick は push せず、前回の一覧を消さない", async () => {
  clearErrorNotices();
  const { monitor, pushed } = createMonitor({
    resolveCommandPaths: async () => {
      throw new Error("login shell is broken");
    },
  });
  monitor.start();
  monitor.stop();
  await flush();

  assert.equal(pushed.length, 0);
  assert.equal(listErrorNotices().length, 1);
});

test("取得できた枠は取得時刻つきで返る", async () => {
  clearErrorNotices();
  const before = Date.now();
  const { monitor, pushed } = createMonitor({
    listProviders: () => [{ provider: "claude", command: "claude" }],
    loadPlanUsage: async () => ({
      state: "ok",
      fiveHour: { usedPercent: 28, resetsAt: 1786000000000 },
      weekly: { usedPercent: 13, resetsAt: null },
    }),
  });
  monitor.start();
  monitor.stop();
  await flush();

  const usage = pushed[0][0];
  assert.equal(usage.state, "ok");
  assert.deepEqual(usage.fiveHour, { usedPercent: 28, resetsAt: 1786000000000 });
  assert.deepEqual(usage.weekly, { usedPercent: 13, resetsAt: null });
  assert.ok(usage.fetchedAt >= before);
});

test("refreshOnce は 1 回取得するだけで定期取得を始めない", async () => {
  clearErrorNotices();
  let ticks = 0;
  const { monitor, pushed } = createMonitor({
    listProviders: () => [{ provider: "claude", command: "claude" }],
    loadPlanUsage: async () => {
      ticks += 1;
      return { state: "ok", fiveHour: null, weekly: null };
    },
  });
  await monitor.refreshOnce();

  assert.equal(ticks, 1);
  assert.equal(pushed.length, 1);
  // 定期取得が始まっていないので stop() は不要。始まっていれば以降も動き続ける。
  monitor.stop();
});
