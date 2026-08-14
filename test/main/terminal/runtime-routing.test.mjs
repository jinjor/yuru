import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

const {
  indexPrimaryWorktreePathsBySessionKey,
  indexTerminalRuntimeIdsByTaskWorktreePath,
  isUnresolvedProviderRuntime,
  resolveTerminalRuntimeTaskWorktreePath,
} = await import("../../../src/main/terminal/runtime-routing.ts");

const taskA = path.resolve("/repo/.yuru/worktrees/task-a");
const taskB = path.resolve("/repo/.yuru/worktrees/task-b");

function providerRuntime(launchWorktreePath, agentSessionId) {
  return {
    provider: "codex",
    agentSessionId,
    launchWorktreePath,
    startedAt: 1,
  };
}

test("primary session の worktree path を session key で引ける", () => {
  const result = indexPrimaryWorktreePathsBySessionKey([
    {
      repoId: "repo-1",
      worktreePath: taskA,
      primarySessions: [{ provider: "codex", agentSessionId: "session-a" }],
    },
    {
      repoId: "repo-1",
      worktreePath: taskB,
      primarySessions: [{ provider: "claude", agentSessionId: "session-b" }],
    },
  ]);

  assert.deepEqual(
    [...result],
    [
      ["codex:session-a", taskA],
      ["claude:session-b", taskB],
    ],
  );
});

test("ID 判明済み provider runtime は primary session の worktree に載る", () => {
  const runtime = providerRuntime(taskA, "session-1");

  assert.equal(isUnresolvedProviderRuntime(runtime), false);
  assert.equal(
    resolveTerminalRuntimeTaskWorktreePath(runtime, new Map([["codex:session-1", taskB]])),
    taskB,
  );
});

test("ID 判明済み provider runtime は primary session がなければ task worktree に載らない", () => {
  assert.equal(
    resolveTerminalRuntimeTaskWorktreePath(providerRuntime(taskA, "session-1"), new Map()),
    null,
  );
});

test("ID 未確定 provider runtime は launch target worktree に暫定表示する", () => {
  const runtime = providerRuntime(taskA, null);

  assert.equal(isUnresolvedProviderRuntime(runtime), true);
  assert.equal(resolveTerminalRuntimeTaskWorktreePath(runtime, new Map()), taskA);
});

test("standalone terminal は launch target worktree に載る", () => {
  const runtime = {
    provider: null,
    agentSessionId: null,
    launchWorktreePath: taskA,
    startedAt: 1,
  };

  assert.equal(isUnresolvedProviderRuntime(runtime), false);
  assert.equal(resolveTerminalRuntimeTaskWorktreePath(runtime, new Map()), taskA);
});

test("runtime 一覧は provider session の primary 移動に追従する", () => {
  const runtimes = new Map([
    ["provider-runtime", providerRuntime(taskA, "session-1")],
    ["unresolved-runtime", providerRuntime(taskA, null)],
    [
      "standalone-runtime",
      {
        provider: null,
        agentSessionId: null,
        launchWorktreePath: taskA,
        startedAt: 2,
      },
    ],
    ["orphan-runtime", providerRuntime(taskA, "orphan-session")],
  ]);

  assert.deepEqual(
    indexTerminalRuntimeIdsByTaskWorktreePath(runtimes, new Map([["codex:session-1", taskB]])),
    new Map([
      [taskB, ["provider-runtime"]],
      [taskA, ["unresolved-runtime", "standalone-runtime"]],
    ]),
  );
});
