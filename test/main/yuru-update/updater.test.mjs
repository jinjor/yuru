import assert from "node:assert/strict";
import test from "node:test";

import { clearErrorNotices } from "../../../src/main/errors/center.ts";
import { YuruUpdater } from "../../../src/main/yuru-update/updater.ts";

function createUpdater(overrides = {}) {
  const pushed = [];
  const recorded = [];
  const quits = [];
  const runner = {
    updateCheckout: async () => ({ ok: true, data: undefined }),
    startAppReplacement: async () => ({ ok: true, data: undefined }),
    ...(overrides.runner ?? {}),
  };
  const updater = new YuruUpdater({
    canUpdate: overrides.canUpdate ?? { ok: true },
    runner,
    stateChanged: (state) => pushed.push(state),
    recordError: (error) => recorded.push(error),
    quit: () => quits.push(true),
  });
  return { updater, pushed, recorded, quits };
}

test("更新できない app では unavailable のまま何も起動しない", async () => {
  clearErrorNotices();
  let started = false;
  const { updater, pushed } = createUpdater({
    canUpdate: { ok: false, reason: "development build" },
    runner: {
      updateCheckout: async () => {
        started = true;
        return { ok: true, data: undefined };
      },
    },
  });

  assert.deepEqual(updater.getState(), { phase: "unavailable", reason: "development build" });
  await updater.start();
  assert.equal(started, false);
  assert.deepEqual(pushed, []);
});

test("前半が成功すると ready で止まり、再起動は押されるまで行わない", async () => {
  clearErrorNotices();
  const { updater, pushed, quits } = createUpdater();

  await updater.start();

  assert.deepEqual(pushed, [{ phase: "updating" }, { phase: "ready" }]);
  assert.deepEqual(quits, []);
});

test("ready から押し直すと、もう一度前半を走らせる", async () => {
  clearErrorNotices();
  let runs = 0;
  const { updater, pushed } = createUpdater({
    runner: {
      updateCheckout: async () => {
        runs += 1;
        return { ok: true, data: undefined };
      },
    },
  });

  await updater.start();
  await updater.start();

  assert.equal(runs, 2);
  assert.deepEqual(pushed, [
    { phase: "updating" },
    { phase: "ready" },
    { phase: "updating" },
    { phase: "ready" },
  ]);
});

test("前半が失敗したら ready にせず、失敗を記録する", async () => {
  clearErrorNotices();
  const error = { code: "command_failed", message: "Updating Yuru failed.", detail: "npm ci" };
  const { updater, pushed, recorded } = createUpdater({
    runner: {
      updateCheckout: async () => ({ ok: false, error }),
    },
  });

  await updater.start();

  assert.deepEqual(pushed, [{ phase: "updating" }, { phase: "idle" }]);
  assert.deepEqual(recorded, [error]);
});

test("ready からの再実行が失敗した時も ready には戻さない", async () => {
  clearErrorNotices();
  let runs = 0;
  const { updater } = createUpdater({
    runner: {
      updateCheckout: async () => {
        runs += 1;
        return runs === 1
          ? { ok: true, data: undefined }
          : { ok: false, error: { code: "command_failed", message: "Updating Yuru failed." } };
      },
    },
  });

  await updater.start();
  await updater.start();

  assert.deepEqual(updater.getState(), { phase: "idle" });
});

test("ready でなければ再起動しない", async () => {
  clearErrorNotices();
  let replacements = 0;
  const { updater, quits } = createUpdater({
    runner: {
      startAppReplacement: async () => {
        replacements += 1;
        return { ok: true, data: undefined };
      },
    },
  });

  await updater.restart();

  assert.equal(replacements, 0);
  assert.deepEqual(quits, []);
});

test("再起動は後半を起動してから終了する", async () => {
  clearErrorNotices();
  const order = [];
  const updater = new YuruUpdater({
    canUpdate: { ok: true },
    runner: {
      updateCheckout: async () => ({ ok: true, data: undefined }),
      startAppReplacement: async () => {
        order.push("start replacement");
        return { ok: true, data: undefined };
      },
    },
    stateChanged: () => {},
    recordError: () => {},
    quit: () => order.push("quit"),
  });

  await updater.start();
  await updater.restart();

  assert.deepEqual(order, ["start replacement", "quit"]);
});

test("後半を起動できなければ終了せず、ready のまま押し直せる", async () => {
  clearErrorNotices();
  const error = { code: "command_failed", message: "Yuru could not start the update." };
  let attempts = 0;
  const { updater, recorded, quits } = createUpdater({
    runner: {
      startAppReplacement: async () => {
        attempts += 1;
        return attempts === 1 ? { ok: false, error } : { ok: true, data: undefined };
      },
    },
  });

  await updater.start();
  await updater.restart();

  assert.deepEqual(quits, []);
  assert.deepEqual(recorded, [error]);
  assert.deepEqual(updater.getState(), { phase: "ready" });

  await updater.restart();
  assert.deepEqual(quits, [true]);
});
