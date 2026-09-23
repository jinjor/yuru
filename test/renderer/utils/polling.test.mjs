import assert from "node:assert/strict";
import test from "node:test";

import { startPollingLoop } from "../../../src/renderer/utils/polling.ts";

// tick 内の await の続きを進めるため、microtask を掃き切ってから次の検証に進む
function drain() {
  return new Promise((resolve) => setImmediate(resolve));
}

// document / window の最小限のスタブ。イベントリスナは発火させず、登録の記録だけする。
function setupPage(t, visibilityState, { focused = true, saveEnergy = true } = {}) {
  const listeners = { window: new Map(), document: new Map() };
  const addTo = (target) => (type, fn) => {
    const list = target.get(type) ?? [];
    list.push(fn);
    target.set(type, list);
  };
  const removeFrom = (target) => (type, fn) => {
    target.set(type, (target.get(type) ?? []).filter((f) => f !== fn));
  };
  globalThis.document = {
    visibilityState,
    hasFocus: () => focused,
    addEventListener: addTo(listeners.document),
    removeEventListener: removeFrom(listeners.document),
  };
  globalThis.window = {
    __yuruSaveEnergy: saveEnergy,
    addEventListener: addTo(listeners.window),
    removeEventListener: removeFrom(listeners.window),
  };
  const cleanup = () => {
    delete globalThis.document;
    delete globalThis.window;
  };
  return {
    fire(target, type) {
      for (const fn of listeners[target].get(type) ?? []) {
        fn();
      }
    },
    setFocused(value) {
      focused = value;
    },
    // stop をグローバルの後始末より先に呼ぶため、1 つの after にまとめる
    teardown(stop) {
      t.after(() => {
        stop();
        cleanup();
      });
    },
  };
}

test("実行完了から interval 後に次を実行し、以降も同じ間隔で繰り返す", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const page = setupPage(t, "visible");

  let calls = 0;
  const stop = startPollingLoop(async () => {
    calls++;
  }, 3000);
  page.teardown(stop);

  await drain();
  assert.equal(calls, 1);

  t.mock.timers.tick(2999);
  await drain();
  assert.equal(calls, 1);

  t.mock.timers.tick(1);
  await drain();
  assert.equal(calls, 2);

  // 何度実行しても間隔は伸びない
  for (let expected = 3; expected <= 10; expected++) {
    t.mock.timers.tick(3000);
    await drain();
    assert.equal(calls, expected);
  }
});

test("実行が interval を超えた時は所要時間と同じだけ待ってから次を実行する", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const page = setupPage(t, "visible");

  let calls = 0;
  let finishRun;
  const stop = startPollingLoop(() => {
    calls++;
    return new Promise((resolve) => {
      finishRun = resolve;
    });
  }, 3000);
  page.teardown(stop);

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

test("非表示の間は実行を省き、表示に戻ったら即座に再開する", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const page = setupPage(t, "hidden");

  let calls = 0;
  const stop = startPollingLoop(async () => {
    calls++;
  }, 3000);
  page.teardown(stop);

  // 初回は非表示でも実行して初期表示のデータを作る
  await drain();
  assert.equal(calls, 1);

  t.mock.timers.tick(3000);
  await drain();
  t.mock.timers.tick(6000);
  await drain();
  assert.equal(calls, 1);

  // 表示に戻ると即座に実行され、以降は interval ごとに実行する
  globalThis.document.visibilityState = "visible";
  page.fire("document", "visibilitychange");
  await drain();
  assert.equal(calls, 2);

  t.mock.timers.tick(3000);
  await drain();
  assert.equal(calls, 3);
});

test("フォーカスが戻ったら即座に実行する", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const page = setupPage(t, "visible", { focused: false });

  let calls = 0;
  const stop = startPollingLoop(
    async () => {
      calls++;
    },
    3000,
    () => document.visibilityState === "visible" && document.hasFocus(),
  );
  page.teardown(stop);

  // 初回はフォーカスがなくても実行する
  await drain();
  assert.equal(calls, 1);

  t.mock.timers.tick(30000);
  await drain();
  assert.equal(calls, 1);

  page.setFocused(true);
  page.fire("window", "focus");
  await drain();
  assert.equal(calls, 2);

  t.mock.timers.tick(3000);
  await drain();
  assert.equal(calls, 3);
});

test("実行が失敗しても次の実行を予約する", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const page = setupPage(t, "visible");
  const consoleError = t.mock.method(console, "error", () => {});

  let calls = 0;
  const stop = startPollingLoop(async () => {
    calls++;
    if (calls === 1) {
      throw new Error("boom");
    }
  }, 3000);
  page.teardown(stop);

  await drain();
  assert.equal(calls, 1);
  assert.equal(consoleError.mock.callCount(), 1);

  t.mock.timers.tick(3000);
  await drain();
  assert.equal(calls, 2);
});

test("停止後は実行されない", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const page = setupPage(t, "visible");

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

test("YURU_SAVE_ENERGY=0 では focus / visibilitychange でも即時実行しない", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const page = setupPage(t, "visible", { saveEnergy: false });

  let calls = 0;
  const stop = startPollingLoop(async () => {
    calls++;
  }, 3000);
  page.teardown(stop);

  await drain();
  assert.equal(calls, 1);

  t.mock.timers.tick(3000);
  await drain();
  assert.equal(calls, 2);
  t.mock.timers.tick(3000);
  await drain();
  assert.equal(calls, 3);

  // リスナを登録していないので、イベントを発火させても即時実行されない
  page.fire("window", "focus");
  page.fire("document", "visibilitychange");
  await drain();
  assert.equal(calls, 3);
});
