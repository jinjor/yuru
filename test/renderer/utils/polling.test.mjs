import assert from "node:assert/strict";
import test from "node:test";

import { startPollingLoop } from "../../../src/renderer/utils/polling.ts";

// tick 内の await の続きを進めるため、microtask を掃き切ってから次の検証に進む
function drain() {
  return new Promise((resolve) => setImmediate(resolve));
}

function setupPage(t, visibilityState) {
  globalThis.document = { visibilityState };
  t.after(() => {
    delete globalThis.document;
  });
}

test("実行完了から interval 後に次を実行する", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  setupPage(t, "visible");

  let calls = 0;
  const stop = startPollingLoop(async () => {
    calls++;
  }, 3000);
  t.after(stop);

  await drain();
  assert.equal(calls, 1);

  t.mock.timers.tick(2999);
  await drain();
  assert.equal(calls, 1);

  t.mock.timers.tick(1);
  await drain();
  assert.equal(calls, 2);
});

test("実行が interval を超えた時は所要時間と同じだけ待ってから次を実行する", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  setupPage(t, "visible");

  let calls = 0;
  let finishRun;
  const stop = startPollingLoop(() => {
    calls++;
    return new Promise((resolve) => {
      finishRun = resolve;
    });
  }, 3000);
  t.after(stop);

  assert.equal(calls, 1);

  // 実行中に 12 秒経過してから完了する
  t.mock.timers.tick(12000);
  finishRun();
  await drain();

  // interval の 3 秒ではなく、所要時間と同じ 12 秒待ってから次が動く
  t.mock.timers.tick(11999);
  await drain();
  assert.equal(calls, 1);

  t.mock.timers.tick(1);
  await drain();
  assert.equal(calls, 2);
});

test("非表示の間は実行を省き、表示に戻ってから再開する", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  setupPage(t, "hidden");

  let calls = 0;
  const stop = startPollingLoop(async () => {
    calls++;
  }, 3000);
  t.after(stop);

  // 初回は非表示でも実行して初期表示のデータを作る
  await drain();
  assert.equal(calls, 1);

  t.mock.timers.tick(3000);
  await drain();
  t.mock.timers.tick(3000);
  await drain();
  assert.equal(calls, 1);

  globalThis.document.visibilityState = "visible";
  t.mock.timers.tick(3000);
  await drain();
  assert.equal(calls, 2);
});

test("実行が失敗しても次の実行を予約する", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  setupPage(t, "visible");
  const consoleError = t.mock.method(console, "error", () => {});

  let calls = 0;
  const stop = startPollingLoop(async () => {
    calls++;
    if (calls === 1) {
      throw new Error("boom");
    }
  }, 3000);
  t.after(stop);

  await drain();
  assert.equal(calls, 1);
  assert.equal(consoleError.mock.callCount(), 1);

  t.mock.timers.tick(3000);
  await drain();
  assert.equal(calls, 2);
});

test("停止後は実行されない", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  setupPage(t, "visible");

  let calls = 0;
  const stop = startPollingLoop(async () => {
    calls++;
  }, 3000);

  await drain();
  assert.equal(calls, 1);

  stop();
  t.mock.timers.tick(10000);
  await drain();
  assert.equal(calls, 1);
});
