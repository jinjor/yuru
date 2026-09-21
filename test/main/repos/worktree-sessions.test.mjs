import assert from "node:assert/strict";
import test from "node:test";

const { toPrimarySessionListItems, toSuggestedSessionListItems } = await import(
  "../../../src/main/repos/worktree-sessions.ts"
);
const { toSessionKey } = await import("../../../src/shared/session.ts");

function source({ runtimeIdsBySessionKey = [], activityStates = [], previews = [] } = {}) {
  return {
    terminalRuntimeIdsBySessionKey: new Map(runtimeIdsBySessionKey),
    agentActivityStatesByTerminalRuntimeId: new Map(activityStates),
    previewsBySessionKey: new Map(previews),
  };
}

test("primary session は一致する runtime があれば active、無ければ inactive で返す", () => {
  const codexKey = toSessionKey("codex", "codex-1");

  assert.deepEqual(
    toPrimarySessionListItems(
      [
        { provider: "codex", agentSessionId: "codex-1" },
        { provider: "claude", agentSessionId: "claude-1" },
      ],
      null,
      source({ runtimeIdsBySessionKey: [[codexKey, "runtime-1"]] }),
    ),
    [
      {
        provider: "codex",
        agentSessionKey: codexKey,
        activeTerminalRuntimeId: "runtime-1",
        state: "active",
        activityState: "waiting",
        preview: "",
      },
      {
        provider: "claude",
        agentSessionKey: toSessionKey("claude", "claude-1"),
        activeTerminalRuntimeId: null,
        state: "inactive",
        activityState: "waiting",
        preview: "",
      },
    ],
  );
});

test("primary session は runtime の活動状態と保存済み preview を載せる", () => {
  const codexKey = toSessionKey("codex", "codex-1");

  assert.deepEqual(
    toPrimarySessionListItems(
      [{ provider: "codex", agentSessionId: "codex-1" }],
      null,
      source({
        runtimeIdsBySessionKey: [[codexKey, "runtime-1"]],
        activityStates: [["runtime-1", "working"]],
        previews: [[codexKey, "latest message"]],
      }),
    ),
    [
      {
        provider: "codex",
        agentSessionKey: codexKey,
        activeTerminalRuntimeId: "runtime-1",
        state: "active",
        activityState: "working",
        preview: "latest message",
      },
    ],
  );
});

test("session ID 未確定の runtime は primary が 1 件も無い時だけ行になる", () => {
  const unresolved = { provider: "kimi", terminalRuntimeId: "runtime-pending" };

  assert.deepEqual(
    toPrimarySessionListItems([], unresolved, source({ activityStates: [["runtime-pending", "working"]] })),
    [
      {
        provider: "kimi",
        agentSessionKey: null,
        activeTerminalRuntimeId: "runtime-pending",
        state: "active",
        activityState: "working",
        preview: "",
      },
    ],
  );

  assert.deepEqual(
    toPrimarySessionListItems(
      [{ provider: "codex", agentSessionId: "codex-1" }],
      unresolved,
      source(),
    ).map((item) => item.agentSessionKey),
    [toSessionKey("codex", "codex-1")],
  );
});

test("suggested session は渡された順のまま、primary と同じ session を除いて返す", () => {
  const codexKey = toSessionKey("codex", "codex-1");
  const claudeKey = toSessionKey("claude", "claude-1");

  assert.deepEqual(
    toSuggestedSessionListItems(
      [
        { provider: "codex", agentSessionId: "codex-1", cwd: "/repo", timestamp: 2 },
        { provider: "claude", agentSessionId: "claude-1", cwd: "/repo", timestamp: 1 },
      ],
      new Set([codexKey]),
      source({
        runtimeIdsBySessionKey: [[claudeKey, "runtime-2"]],
        activityStates: [["runtime-2", "working"]],
        previews: [[claudeKey, "hello"]],
      }),
    ),
    [
      {
        provider: "claude",
        agentSessionKey: claudeKey,
        activeTerminalRuntimeId: "runtime-2",
        state: "active",
        activityState: "working",
        preview: "hello",
        timestamp: 1,
      },
    ],
  );
});
