import assert from "node:assert/strict";
import test from "node:test";

const { applyPrimarySessionState } = await import(
  "../../../src/renderer/terminal/suggestedSessionState.ts"
);

function suggested(agentSessionKey, overrides = {}) {
  return {
    provider: "codex",
    agentSessionKey,
    activeTerminalRuntimeId: null,
    state: "inactive",
    activityState: "waiting",
    preview: "old preview",
    timestamp: 1,
    ...overrides,
  };
}

function primary(agentSessionKey, overrides = {}) {
  return {
    provider: "codex",
    agentSessionKey,
    activeTerminalRuntimeId: null,
    state: "inactive",
    activityState: "waiting",
    preview: "old preview",
    ...overrides,
  };
}

test("同じ session の行に active・活動状態・preview を写す", () => {
  const sessions = [suggested("codex:a"), suggested("codex:b")];

  assert.deepEqual(
    applyPrimarySessionState(sessions, [
      primary("codex:b", {
        activeTerminalRuntimeId: "runtime-1",
        state: "active",
        activityState: "working",
        preview: "new preview",
      }),
    ]),
    [
      sessions[0],
      {
        ...sessions[1],
        activeTerminalRuntimeId: "runtime-1",
        state: "active",
        activityState: "working",
        preview: "new preview",
      },
    ],
  );
});

test("session が終わった表示状態は suggested の行も inactive に戻す", () => {
  const sessions = [
    suggested("codex:a", {
      activeTerminalRuntimeId: "runtime-1",
      state: "active",
      activityState: "working",
    }),
  ];

  assert.deepEqual(applyPrimarySessionState(sessions, [primary("codex:a")]), [suggested("codex:a")]);
});

test("一致する session が無ければ、または状態が同じなら元の配列をそのまま返す", () => {
  const sessions = [suggested("codex:a")];

  assert.equal(applyPrimarySessionState(sessions, [primary("codex:other")]), sessions);
  assert.equal(applyPrimarySessionState(sessions, [primary("codex:a")]), sessions);
  // session ID が未確定の行は突き合わせに使わない。
  assert.equal(applyPrimarySessionState(sessions, [primary(null)]), sessions);
});

test("並びと timestamp は suggested 側のまま保つ", () => {
  const sessions = [suggested("codex:a", { timestamp: 5 }), suggested("codex:b", { timestamp: 9 })];
  const next = applyPrimarySessionState(sessions, [primary("codex:a", { preview: "changed" })]);

  assert.deepEqual(
    next.map((session) => [session.agentSessionKey, session.timestamp]),
    [
      ["codex:a", 5],
      ["codex:b", 9],
    ],
  );
});
