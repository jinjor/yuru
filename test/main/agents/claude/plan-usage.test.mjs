import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadClaudePlanUsage } from "../../../../src/main/agents/claude/plan-usage.ts";

test("Claude の auth status が終了コード 1 で未ログイン JSON を返したら logged-out にする", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "yuru-claude-plan-usage-test-"));
  const commandPath = path.join(dir, "claude");
  await writeFile(
    commandPath,
    `#!/bin/sh
if [ "$1" = "auth" ]; then
  echo '{"loggedIn":false,"authMethod":"none"}'
  exit 1
fi
read -r request
echo '{"type":"control_response","response":{"subtype":"success","request_id":"yuru-plan-usage","response":{"rate_limits_available":false,"rate_limits":null}}}'
`,
  );
  await chmod(commandPath, 0o755);

  try {
    assert.deepEqual(
      await loadClaudePlanUsage({ path: commandPath, pathEnv: process.env.PATH ?? "" }),
      { state: "logged-out" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
