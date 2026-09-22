import type { PrimarySessionListItem, SuggestedSessionListItem } from "../../shared/metadata";

// 動いている session は必ずどこかの worktree の primary でもある (runtime は primary link を
// 持つ)。そのため、suggested として出している行の active / 活動状態 / preview は、その
// session が primary になっている worktree の表示状態に現れる。届いた表示状態から、
// 同じ session の行にその状態を写す。
export function applyPrimarySessionState(
  suggestedSessions: SuggestedSessionListItem[],
  primarySessions: readonly PrimarySessionListItem[],
): SuggestedSessionListItem[] {
  const primarySessionsByKey = new Map(
    primarySessions.flatMap((session) =>
      session.agentSessionKey === null ? [] : [[session.agentSessionKey, session] as const],
    ),
  );
  let changed = false;
  const next = suggestedSessions.map((suggestedSession) => {
    const primarySession = primarySessionsByKey.get(suggestedSession.agentSessionKey);
    if (!primarySession || !hasDifferentState(suggestedSession, primarySession)) {
      return suggestedSession;
    }
    changed = true;
    return {
      ...suggestedSession,
      activeTerminalRuntimeId: primarySession.activeTerminalRuntimeId,
      state: primarySession.state,
      activityState: primarySession.activityState,
      preview: primarySession.preview,
    };
  });
  return changed ? next : suggestedSessions;
}

function hasDifferentState(
  suggestedSession: SuggestedSessionListItem,
  primarySession: PrimarySessionListItem,
): boolean {
  return (
    suggestedSession.activeTerminalRuntimeId !== primarySession.activeTerminalRuntimeId ||
    suggestedSession.state !== primarySession.state ||
    suggestedSession.activityState !== primarySession.activityState ||
    suggestedSession.preview !== primarySession.preview
  );
}
