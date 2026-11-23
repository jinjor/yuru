import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadAntigravityPlanUsage } from "../../../../src/main/agents/antigravity/plan-usage.ts";

async function withFakeAgy(scriptBody, run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "yuru-antigravity-plan-usage-test-"));
  const commandPath = path.join(dir, "agy");
  await writeFile(commandPath, `#!/bin/sh\n${scriptBody}\n`);
  await chmod(commandPath, 0o755);
  try {
    return await run({ path: commandPath, pathEnv: process.env.PATH ?? "" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("agy /usage の JSON から Gemini Models グループの 5h / 7d 枠を取り出す", async () => {
  const payload = {
    conversation_id: "",
    status: "SUCCESS",
    command: {
      name: "usage",
      data: {
        groups: [
          {
            name: "Claude and GPT models",
            buckets: [
              {
                id: "3p-5h",
                window: "5h",
                remaining_fraction: 0.5,
                reset_time: "2026-11-23T20:00:00Z",
              },
            ],
          },
          {
            name: "Gemini Models",
            buckets: [
              {
                id: "gemini-weekly",
                window: "weekly",
                remaining_fraction: 0.75,
                reset_time: "2026-11-30T15:41:57Z",
              },
              {
                id: "gemini-5h",
                window: "5h",
                remaining_fraction: 0.4,
                reset_time: "2026-11-23T20:41:57Z",
              },
            ],
          },
          {
            name: "Gemini 4 Argon",
            buckets: [
              {
                id: "gemini-argon-wtu-weekly",
                window: "weekly",
                remaining_fraction: 0.9,
                reset_time: "2026-11-30T15:50:39Z",
              },
            ],
          },
        ],
      },
    },
  };

  const usage = await withFakeAgy(`printf '%s\n' '${JSON.stringify(payload)}'`, (command) =>
    loadAntigravityPlanUsage(command),
  );

  assert.equal(usage.state, "ok");
  assert.ok(Math.abs(usage.fiveHour.usedPercent - 60) < 1e-9);
  assert.equal(usage.fiveHour.resetsAt, Date.parse("2026-11-23T20:41:57Z"));
  assert.ok(Math.abs(usage.weekly.usedPercent - 25) < 1e-9);
  assert.equal(usage.weekly.resetsAt, Date.parse("2026-11-30T15:41:57Z"));
});

test("agy /usage の groups が空配列なら no-plan-limits にする", async () => {
  const payload = {
    status: "SUCCESS",
    command: { name: "usage", data: { groups: [] } },
  };

  const usage = await withFakeAgy(`printf '%s\n' '${JSON.stringify(payload)}'`, (command) =>
    loadAntigravityPlanUsage(command),
  );

  assert.deepEqual(usage, { state: "no-plan-limits" });
});

test("agy /usage が未知の形式を返したら例外にする", async () => {
  await withFakeAgy(`printf '%s\n' '{"status":"SUCCESS","command":{"name":"usage","data":{}}}'`, (command) =>
    assert.rejects(loadAntigravityPlanUsage(command), /no quota groups/),
  );
});
