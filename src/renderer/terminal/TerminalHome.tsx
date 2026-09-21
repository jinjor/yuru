import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, Unlink } from "lucide-react";
import type { PrimarySessionListItem, SuggestedSessionListItem } from "../../shared/metadata";
import type { SessionProvider, TerminalRuntimeId } from "../../shared/session";
import { providerLabel } from "../providers/providerLabel";
import { SessionProviderDot } from "../providers/SessionProviderDot";
import { useReorderDrag, type ReorderDrag } from "../utils/useReorderDrag";

interface TerminalHomeProps {
  isMainWorktree: boolean;
  primarySessions: PrimarySessionListItem[];
  providers: SessionProvider[];
  worktreeId: string;
  onSelectPrimarySession: (terminalRuntimeId: TerminalRuntimeId) => void;
  onResumePrimarySession: (agentSessionKey: string) => void;
  onDetachPrimarySession: (agentSessionKey: string) => void;
  onReorderPrimarySessions: (agentSessionKeys: string[]) => void;
  onResumeSuggestedSession: (agentSessionKey: string) => void;
  onCreateSessionForWorktree: (provider: SessionProvider) => void;
  onOpenWorktreeTerminal: () => void;
}

// Terminal のホーム。primary / suggested の選択と新規 session の開始導線を常にまとめて出す。
export function TerminalHome({
  isMainWorktree,
  primarySessions,
  providers,
  worktreeId,
  onSelectPrimarySession,
  onResumePrimarySession,
  onDetachPrimarySession,
  onReorderPrimarySessions,
  onResumeSuggestedSession,
  onCreateSessionForWorktree,
  onOpenWorktreeTerminal,
}: TerminalHomeProps) {
  const homeRef = useRef<HTMLDivElement>(null);
  const primarySessionKeys = primarySessions.flatMap((primarySession) =>
    primarySession.agentSessionKey === null ? [] : [primarySession.agentSessionKey],
  );
  const suggestedSessions = useSuggestedSessions(
    isMainWorktree ? null : worktreeId,
    primarySessionKeys,
  );
  // 並び替えられるのは Sessions の行だけ。Suggested と New session は掴めず、
  // 落とす先にもならない。
  const sessionReorder = useReorderDrag({
    itemIds: primarySessionKeys,
    containerRef: homeRef,
    onReorder: onReorderPrimarySessions,
  });
  return (
    <div className="terminal-session-start" ref={homeRef}>
      <div className="terminal-session-start-panel">
        {isMainWorktree ? (
          <OpenTerminalSection onOpen={onOpenWorktreeTerminal} />
        ) : (
          <>
            {primarySessions.length > 0 && (
              <div className="action-surface-section">
                <div className="action-surface-label">Sessions</div>
                {primarySessions.map((primarySession) => (
                  <PrimarySessionAction
                    key={primarySession.agentSessionKey ?? primarySession.activeTerminalRuntimeId}
                    primarySession={primarySession}
                    reorder={sessionReorder}
                    onSelectRuntime={onSelectPrimarySession}
                    onResume={onResumePrimarySession}
                    onDetach={onDetachPrimarySession}
                  />
                ))}
              </div>
            )}
            {suggestedSessions.length > 0 && (
              <div className="action-surface-section">
                <div className="action-surface-label">Suggested</div>
                {suggestedSessions.map((suggestedSession) => (
                  <SuggestedSessionAction
                    key={suggestedSession.agentSessionKey}
                    suggestedSession={suggestedSession}
                    onSelect={() => onResumeSuggestedSession(suggestedSession.agentSessionKey)}
                  />
                ))}
              </div>
            )}
            <div className="action-surface-section">
              <div className="action-surface-label">New session</div>
              <div className="new-session-actions">
                {providers.map((provider) => (
                  <button
                    type="button"
                    key={provider}
                    className="action-surface-row new-session-action"
                    onClick={() => onCreateSessionForWorktree(provider)}
                    title={`Start new ${providerLabel(provider)} session`}
                  >
                    <span
                      className={`session-provider-dot provider-${provider}`}
                      aria-hidden="true"
                    />
                    <span className="action-surface-row-main">{providerLabel(provider)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Yuru の外で作られた session の推測は agent store 全体の走査になるので、一覧にも
// worktree の表示状態にも載せず、この画面が出ている間だけ取りに行く。取り直すのは
// primary session の顔ぶれが変わった時 (detach で 1 件増え、昇格で 1 件減る) だけで、
// 動作中 session の preview 更新では取り直さない。
function useSuggestedSessions(
  worktreeId: string | null,
  primarySessionKeys: readonly string[],
): SuggestedSessionListItem[] {
  const [suggestedSessions, setSuggestedSessions] = useState<SuggestedSessionListItem[]>([]);
  const primarySessionKey = primarySessionKeys.join("\n");

  useEffect(() => {
    if (!worktreeId) {
      return;
    }
    let cancelled = false;
    window.electronAPI
      .getSuggestedSessions(worktreeId)
      .then((sessions) => {
        if (!cancelled) {
          setSuggestedSessions(sessions);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to load suggested sessions.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [primarySessionKey, worktreeId]);

  return suggestedSessions;
}

interface OpenTerminalSectionProps {
  onOpen: () => void;
}

function OpenTerminalSection({ onOpen }: OpenTerminalSectionProps) {
  return (
    <div className="action-surface-section">
      <div className="action-surface-label">Terminal</div>
      <button
        type="button"
        className="action-surface-row new-session-action open-terminal-action"
        onClick={onOpen}
        title="Open a terminal in this worktree"
      >
        <TerminalIcon size={14} strokeWidth={2} aria-hidden="true" />
        <span className="action-surface-row-main">Open Terminal</span>
      </button>
    </div>
  );
}

interface PrimarySessionActionProps {
  primarySession: PrimarySessionListItem;
  reorder: ReorderDrag;
  onSelectRuntime: (terminalRuntimeId: TerminalRuntimeId) => void;
  onResume: (agentSessionKey: string) => void;
  onDetach: (agentSessionKey: string) => void;
}

function PrimarySessionAction({
  primarySession,
  reorder,
  onSelectRuntime,
  onResume,
  onDetach,
}: PrimarySessionActionProps) {
  const preview = primarySession.preview || "(no messages)";
  const providerName = providerLabel(primarySession.provider);
  const agentSessionKey = primarySession.agentSessionKey;
  const terminalRuntimeId = primarySession.activeTerminalRuntimeId;
  const canSelect =
    primarySession.state === "active" ? terminalRuntimeId !== null : agentSessionKey !== null;
  return (
    <div
      className={[
        "action-surface-row primary-session-action session-home-row",
        primarySession.state,
        // agentSessionKey が並び替えでの ID。起動直後の、まだ session id が決まっていない
        // 行だけは持たないので掴めないが、その時この worktree の行はそれ 1 つしかない。
        agentSessionKey === null ? "" : reorder.itemClassName(agentSessionKey),
      ].join(" ")}
      style={agentSessionKey === null ? undefined : reorder.itemStyle(agentSessionKey)}
      data-reorder-id={agentSessionKey ?? undefined}
      onPointerDown={(event) => {
        if (agentSessionKey !== null) {
          reorder.onItemPointerDown(agentSessionKey, event);
        }
      }}
    >
      <button
        type="button"
        className="session-home-select resume-primary-action"
        data-reorder-grab=""
        disabled={!canSelect}
        onClick={() => {
          if (primarySession.state === "active" && terminalRuntimeId) {
            onSelectRuntime(terminalRuntimeId);
          } else if (primarySession.state === "inactive" && agentSessionKey) {
            onResume(agentSessionKey);
          }
        }}
        title={
          primarySession.state === "active"
            ? `Show ${providerName} session`
            : `Resume ${providerName} session`
        }
      >
        <SessionProviderDot
          kind="primary"
          provider={primarySession.provider}
          state={primarySession.state}
          activityState={primarySession.activityState}
        />
        <span className="action-surface-row-text">
          <span className="action-surface-row-main" title={preview}>
            {preview}
          </span>
          <span className="action-surface-row-meta">
            {providerName} · {primarySession.state}
          </span>
        </span>
      </button>
      {primarySession.state === "inactive" && agentSessionKey !== null && (
        <button
          type="button"
          className="session-detach-action detach-primary-action"
          onClick={() => onDetach(agentSessionKey)}
          title={`Detach this ${providerName} session from the worktree. History is kept.`}
        >
          <Unlink size={12} strokeWidth={2} aria-hidden="true" />
          <span>Detach</span>
        </button>
      )}
    </div>
  );
}

interface SuggestedSessionActionProps {
  suggestedSession: SuggestedSessionListItem;
  onSelect: () => void;
}

function SuggestedSessionAction({ suggestedSession, onSelect }: SuggestedSessionActionProps) {
  const preview = suggestedSession.preview || "(no messages)";
  const providerName = providerLabel(suggestedSession.provider);
  const isActive = suggestedSession.state === "active";
  const activityState = suggestedSession.activityState;
  const timestamp = formatSessionTimestamp(suggestedSession.timestamp);
  const meta = [providerName, isActive ? "active" : null, timestamp]
    .filter((value) => value !== null && value !== "")
    .join(" · ");
  return (
    <button
      type="button"
      className={`action-surface-row suggested-session-action ${suggestedSession.state}`}
      onClick={onSelect}
      title={isActive ? `Promote active ${providerName} session` : `Resume ${providerName}`}
    >
      <SessionProviderDot
        kind="suggested"
        provider={suggestedSession.provider}
        state={suggestedSession.state}
        activityState={activityState}
      />
      <span className="action-surface-row-text">
        <span className="action-surface-row-main" title={preview}>
          {preview}
        </span>
        <span className="action-surface-row-meta">{meta}</span>
      </span>
    </button>
  );
}

function formatSessionTimestamp(timestamp: number): string {
  if (!timestamp) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
