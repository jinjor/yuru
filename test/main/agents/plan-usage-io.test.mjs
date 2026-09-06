import assert from "node:assert/strict";
import test from "node:test";

import {
  stopPlanUsageProcesses,
  withPlanUsageProcess,
} from "../../../src/main/agents/plan-usage-io.ts";

const shell = { path: "/bin/sh", pathEnv: "/bin:/usr/bin" };

// 応答を返さない CLI。時間切れを待たずに止められることを見るため、時間切れは十分長く取る。
function startSilentCommand(onChild) {
  return withPlanUsageProcess(shell, ["-c", "while :; do sleep 1; done"], 60_000, (child) => {
    onChild(child);
    return new Promise(() => {});
  });
}

test("応答を待っている途中でも stopPlanUsageProcesses で子プロセスが終わる", async () => {
  let pid;
  const pending = startSilentCommand((child) => {
    pid = child.pid;
  });

  await stopPlanUsageProcesses();

  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await assert.rejects(pending);
});

test("stdin のエラーはプロセスを落とさない", async () => {
  let child;
  const pending = startSilentCommand((spawned) => {
    child = spawned;
  });

  // kill した子へ要求を書き込もうとすると実際に上がるのがこれ。受け手がいないと
  // uncaughtException になり、プロセスごと落ちる (Electron ではモーダルの
  // エラーダイアログが出たまま固まる)。
  assert.doesNotThrow(() => {
    child.stdin.emit("error", new Error("write EPIPE"));
  });

  await stopPlanUsageProcesses();
  await assert.rejects(pending);
});
