import { Terminal as TerminalIcon, Unlink } from "lucide-react";
import type {
  PrimarySessionListItem,
  SuggestedSessionListItem,
  WorktreeListItem,
} from "../../shared/metadata";
import type { SessionProvider, TerminalRuntimeId } from "../../shared/session";
import { providerLabel } from "../shared/providerLabel";
import { SessionProviderDot } from "../shared/SessionProviderDot";

interface TerminalSessionStartProps {
  providers: SessionProvider[];
  worktree: WorktreeListItem | null;
  onSelectPrimarySession: (terminalRuntimeId: TerminalRuntimeId) => void;
  onResumePrimarySession: (providerSessionKey: string) => void;
  onDetachPrimarySession: (providerSessionKey: string) => void;
  onResumeSuggestedSession: (providerSessionKey: string) => void;
  onCreateSessionForWorktree: (provider: SessionProvider) => void;
  onOpenWorktreeTerminal: () => void;
}

// Terminal のホーム。primary / suggested の選択と新規 session の開始導線を常にまとめて出す。
export function TerminalSessionStart({
  providers,
  worktree,
  onSelectPrimarySession,
  onResumePrimarySession,
  onDetachPrimarySession,
  onResumeSuggestedSession,
  onCreateSessionForWorktree,
  onOpenWorktreeTerminal,
}: TerminalSessionStartProps) {
  return (
    <div className="terminal-session-start">
      {worktree && (
        <div className="terminal-session-start-panel">
          {worktree.isMainWorktree ? (
            <OpenTerminalSection onOpen={onOpenWorktreeTerminal} />
          ) : (
            <>
              {worktree.primarySessions.length > 0 && (
                <div className="action-surface-section">
                  <div className="action-surface-label">Sessions</div>
                  {worktree.primarySessions.map((primarySession) => (
                    <PrimarySessionAction
                      key={
                        primarySession.providerSessionKey ?? primarySession.activeTerminalRuntimeId
                      }
                      primarySession={primarySession}
                      onSelectRuntime={onSelectPrimarySession}
                      onResume={onResumePrimarySession}
                      onDetach={onDetachPrimarySession}
                    />
                  ))}
                </div>
              )}
              {worktree.suggestedSessions.length > 0 && (
                <div className="action-surface-section">
                  <div className="action-surface-label">Suggested</div>
                  {worktree.suggestedSessions.map((suggestedSession) => (
                    <SuggestedSessionAction
                      key={suggestedSession.providerSessionKey}
                      suggestedSession={suggestedSession}
                      onSelect={() => onResumeSuggestedSession(suggestedSession.providerSessionKey)}
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
      )}
    </div>
  );
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
  onSelectRuntime: (terminalRuntimeId: TerminalRuntimeId) => void;
  onResume: (providerSessionKey: string) => void;
  onDetach: (providerSessionKey: string) => void;
}

function PrimarySessionAction({
  primarySession,
  onSelectRuntime,
  onResume,
  onDetach,
}: PrimarySessionActionProps) {
  const preview = primarySession.preview || "(no messages)";
  const providerName = providerLabel(primarySession.provider);
  const providerSessionKey = primarySession.providerSessionKey;
  const terminalRuntimeId = primarySession.activeTerminalRuntimeId;
  const canSelect =
    primarySession.state === "active" ? terminalRuntimeId !== null : providerSessionKey !== null;
  return (
    <div
      className={`action-surface-row primary-session-action session-home-row ${primarySession.state}`}
    >
      <button
        type="button"
        className="session-home-select resume-primary-action"
        disabled={!canSelect}
        onClick={() => {
          if (primarySession.state === "active" && terminalRuntimeId) {
            onSelectRuntime(terminalRuntimeId);
          } else if (primarySession.state === "inactive" && providerSessionKey) {
            onResume(providerSessionKey);
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
      {primarySession.state === "inactive" && providerSessionKey !== null && (
        <button
          type="button"
          className="session-detach-action detach-primary-action"
          onClick={() => onDetach(providerSessionKey)}
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
