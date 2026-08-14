import type { TaskWorktreeMetadata } from "../../shared/metadata.js";
import { toSessionKey, type SessionProvider } from "../../shared/session.js";
import { toWorktreePathKey } from "../worktree-identity.js";
import type { TerminalRuntimeInfo } from "./runtime.js";

export function isUnresolvedProviderRuntime(
  runtime: TerminalRuntimeInfo,
): runtime is TerminalRuntimeInfo & { provider: SessionProvider; agentSessionId: null } {
  return runtime.provider !== null && runtime.agentSessionId === null;
}

export function indexPrimaryWorktreePathsBySessionKey(
  taskWorktrees: readonly TaskWorktreeMetadata[],
): Map<string, string> {
  const worktreePathsBySessionKey = new Map<string, string>();
  for (const taskWorktree of taskWorktrees) {
    for (const primarySession of taskWorktree.primarySessions) {
      worktreePathsBySessionKey.set(
        toSessionKey(primarySession.provider, primarySession.agentSessionId),
        toWorktreePathKey(taskWorktree.worktreePath),
      );
    }
  }
  return worktreePathsBySessionKey;
}

export function resolveTerminalRuntimeTaskWorktreePath(
  runtime: TerminalRuntimeInfo,
  primaryWorktreePathsBySessionKey: ReadonlyMap<string, string>,
): string | null {
  if (runtime.provider === null || isUnresolvedProviderRuntime(runtime)) {
    return toWorktreePathKey(runtime.launchWorktreePath);
  }
  return (
    primaryWorktreePathsBySessionKey.get(toSessionKey(runtime.provider, runtime.agentSessionId)) ??
    null
  );
}

export function indexTerminalRuntimeIdsByTaskWorktreePath(
  terminalRuntimes: ReadonlyMap<string, TerminalRuntimeInfo>,
  primaryWorktreePathsBySessionKey: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const runtimeIdsByWorktreePath = new Map<string, string[]>();
  for (const [terminalRuntimeId, runtime] of terminalRuntimes) {
    const worktreePath = resolveTerminalRuntimeTaskWorktreePath(
      runtime,
      primaryWorktreePathsBySessionKey,
    );
    if (!worktreePath) {
      continue;
    }
    const runtimeIds = runtimeIdsByWorktreePath.get(worktreePath);
    if (runtimeIds) {
      runtimeIds.push(terminalRuntimeId);
    } else {
      runtimeIdsByWorktreePath.set(worktreePath, [terminalRuntimeId]);
    }
  }
  return runtimeIdsByWorktreePath;
}
