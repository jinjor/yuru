import assert from "node:assert/strict";
import test from "node:test";

const { TerminalRuntimeRefreshScheduler } = await import(
  "../../src/main/terminal-runtime-refresh-scheduler.ts"
);

class FakeTimers {
  timers = [];

  setTimeout(callback, delayMs) {
    const timer = {
      callback,
      delayMs,
      active: true,
    };
    this.timers.push(timer);
    return timer;
  }

  clearTimeout(timer) {
    timer.active = false;
  }

  activeDelays() {
    return this.timers.filter((timer) => timer.active).map((timer) => timer.delayMs);
  }

  fireNext() {
    const timer = this.timers.find((entry) => entry.active);
    assert.ok(timer);
    timer.active = false;
    timer.callback();
    return timer.delayMs;
  }

  api() {
    return {
      setTimeout: (callback, delayMs) => this.setTimeout(callback, delayMs),
      clearTimeout: (timer) => this.clearTimeout(timer),
    };
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

test("TerminalRuntimeRefreshScheduler は settled 後に refresh due を通知し backoff を続ける", async () => {
  const timers = new FakeTimers();
  const refreshes = [];
  const scheduler = new TerminalRuntimeRefreshScheduler({
    onRefreshDue: (terminalRuntimeId) => {
      refreshes.push(terminalRuntimeId);
    },
    outputSettledDelayMs: 12,
    backoffDelaysMs: [30, 60],
    timerApi: timers.api(),
  });

  scheduler.recordActivity("runtime-1");
  assert.deepEqual(timers.activeDelays(), [12]);

  assert.equal(timers.fireNext(), 12);
  await flushAsyncWork();
  assert.deepEqual(refreshes, ["runtime-1"]);
  assert.deepEqual(timers.activeDelays(), [30]);

  assert.equal(timers.fireNext(), 30);
  await flushAsyncWork();
  assert.deepEqual(refreshes, ["runtime-1", "runtime-1"]);
  assert.deepEqual(timers.activeDelays(), [60]);

  assert.equal(timers.fireNext(), 60);
  await flushAsyncWork();
  assert.deepEqual(refreshes, ["runtime-1", "runtime-1", "runtime-1"]);
  assert.deepEqual(timers.activeDelays(), [60]);
});

test("TerminalRuntimeRefreshScheduler は新しい activity で古い refresh 列を止める", async () => {
  const timers = new FakeTimers();
  const firstRefresh = deferred();
  let calls = 0;
  const scheduler = new TerminalRuntimeRefreshScheduler({
    onRefreshDue: () => {
      calls += 1;
      return calls === 1 ? firstRefresh.promise : undefined;
    },
    outputSettledDelayMs: 12,
    backoffDelaysMs: [30, 60],
    timerApi: timers.api(),
  });

  scheduler.recordActivity("runtime-1");
  assert.equal(timers.fireNext(), 12);
  await flushAsyncWork();
  assert.equal(calls, 1);

  scheduler.recordActivity("runtime-1");
  assert.deepEqual(timers.activeDelays(), [12]);

  firstRefresh.resolve();
  await flushAsyncWork();
  assert.deepEqual(timers.activeDelays(), [12]);
});

test("TerminalRuntimeRefreshScheduler は clear された terminal runtime を再スケジュールしない", async () => {
  const timers = new FakeTimers();
  const firstRefresh = deferred();
  const scheduler = new TerminalRuntimeRefreshScheduler({
    onRefreshDue: () => firstRefresh.promise,
    outputSettledDelayMs: 12,
    backoffDelaysMs: [30],
    timerApi: timers.api(),
  });

  scheduler.recordActivity("runtime-1");
  assert.equal(timers.fireNext(), 12);
  await flushAsyncWork();

  scheduler.clear("runtime-1");
  firstRefresh.resolve();
  await flushAsyncWork();

  assert.deepEqual(timers.activeDelays(), []);
});
