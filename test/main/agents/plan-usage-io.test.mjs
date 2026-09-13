import assert from "node:assert/strict";
import test from "node:test";

import {
  stopPlanUsageProcesses,
  withPlanUsageProcess,
  runPlanUsageCommand,
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

const node = { path: process.execPath, pathEnv: process.env.PATH };

for (const completes of [true, false]) {
  test(`${completes ? "応答後" : "時間切れ後"}も SIGTERM を無視する CLI の終了を待つ`, async (t) => {
    let child;
    t.after(() => {
      if (child?.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
    const pending = withPlanUsageProcess(
      node,
      ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 60000);"],
      1_000,
      (spawned) => {
        child = spawned;
        return new Promise((resolve) => {
          child.stdout.once("data", () => {
            if (completes) resolve("response");
          });
        });
      },
    );
    if (completes) assert.equal(await pending, "response");
    else await assert.rejects(pending, /did not respond/);
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  });
}

test("終了済み CLI と起動できなかった CLI の後片付けは待ち続けない", { timeout: 5_000 }, async () => {
  assert.equal(await runPlanUsageCommand(node, ["-e", "console.log('done')"], 1_000), "done\n");
  await assert.rejects(
    runPlanUsageCommand({ ...node, path: "/nonexistent-yuru-usage-cli" }, [], 1_000),
    { code: "ENOENT" },
  );
  await stopPlanUsageProcesses();
});
