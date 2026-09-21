import type {
  PrimarySessionListItem,
  PrimarySessionMetadata,
  SuggestedSessionListItem,
} from "../../shared/metadata.js";
import {
  toSessionKey,
  type AgentActivityState,
  type SessionProvider,
  type SuggestedWorktreeSession,
} from "../../shared/session.js";

// session ID がまだ確定していない runtime。primary link を持てないので、起動対象の
// worktree にだけ現れる。
export interface UnresolvedTerminalRuntime {
  provider: SessionProvider;
  terminalRuntimeId: string;
}

// session 1 件を表示するのに要る、その時点の実行状態。どれも main のメモリか
// agent store から引いた値で、この module 自体は取得を行わない。
export interface SessionDisplaySource {
  terminalRuntimeIdsBySessionKey: ReadonlyMap<string, string>;
  agentActivityStatesByTerminalRuntimeId: ReadonlyMap<string, AgentActivityState>;
  previewsBySessionKey: ReadonlyMap<string, string>;
}

export function toPrimarySessionListItems(
  primarySessions: readonly PrimarySessionMetadata[],
  unresolvedTerminalRuntime: UnresolvedTerminalRuntime | null,
  source: SessionDisplaySource,
): PrimarySessionListItem[] {
  const items = primarySessions.map((primarySession): PrimarySessionListItem => {
    const agentSessionKey = toSessionKey(primarySession.provider, primarySession.agentSessionId);
    const activeTerminalRuntimeId =
      source.terminalRuntimeIdsBySessionKey.get(agentSessionKey) ?? null;
    return {
      provider: primarySession.provider,
      agentSessionKey,
      activeTerminalRuntimeId,
      state: activeTerminalRuntimeId ? "active" : "inactive",
      activityState: toActivityState(activeTerminalRuntimeId, source),
      preview: source.previewsBySessionKey.get(agentSessionKey) ?? "",
    };
  });
  // ID 未確定の runtime は、primary が 1 件も無い間だけ「その worktree で動いている
  // session」として出す。ID が決まれば primary に attach されてこの行は消える。
  if (primarySessions.length === 0 && unresolvedTerminalRuntime) {
    items.push({
      provider: unresolvedTerminalRuntime.provider,
      agentSessionKey: null,
      activeTerminalRuntimeId: unresolvedTerminalRuntime.terminalRuntimeId,
      state: "active",
      activityState: toActivityState(unresolvedTerminalRuntime.terminalRuntimeId, source),
      preview: "",
    });
  }
  return items;
}

export function toSuggestedSessionListItems(
  suggestedSessions: readonly SuggestedWorktreeSession[],
  excludedSessionKeys: ReadonlySet<string>,
  source: SessionDisplaySource,
): SuggestedSessionListItem[] {
  return suggestedSessions.flatMap((session) => {
    const agentSessionKey = toSessionKey(session.provider, session.agentSessionId);
    if (excludedSessionKeys.has(agentSessionKey)) {
      return [];
    }
    const activeTerminalRuntimeId =
      source.terminalRuntimeIdsBySessionKey.get(agentSessionKey) ?? null;
    return [
      {
        provider: session.provider,
        agentSessionKey,
        activeTerminalRuntimeId,
        state: activeTerminalRuntimeId ? "active" : "inactive",
        activityState: toActivityState(activeTerminalRuntimeId, source),
        preview: source.previewsBySessionKey.get(agentSessionKey) ?? "",
        timestamp: session.timestamp ?? 0,
      } satisfies SuggestedSessionListItem,
    ];
  });
}

function toActivityState(
  activeTerminalRuntimeId: string | null,
  source: SessionDisplaySource,
): AgentActivityState {
  if (!activeTerminalRuntimeId) {
    return "waiting";
  }
  return source.agentActivityStatesByTerminalRuntimeId.get(activeTerminalRuntimeId) ?? "waiting";
}
