import { Terminal as TerminalIcon, Unlink } from "lucide-react";
import type {
  PrimarySessionListItem,
  SuggestedSessionListItem,
  WorktreeListItem,
} from "../../shared/metadata";
import type { GitHubPullRequest, SessionProvider } from "../../shared/session";
import { providerLabel } from "../utils/session";
import { SessionProviderDot } from "./SessionProviderDot";
import { TerminalBar } from "./TerminalBar";

interface TerminalSessionStartProps {
  currentBranch: string | null;
  currentGitHub: GitHubPullRequest | null;
  onOpenExternal: (url: string) => void;
  providers: SessionProvider[];
  worktree: WorktreeListItem | null;
  onResumePrimarySession: (providerSessionKey: string) => void;
  onDetachPrimarySession: (providerSessionKey: string) => void;
  onResumeSuggestedSession: (providerSessionKey: string) => void;
  onCreateSessionForWorktree: (provider: SessionProvider) => void;
  onOpenWorktreeTerminal: () => void;
}

// 選択中 worktree に表示すべき terminal runtime がない時に、Terminal パネルの本文に出す
// session start surface。
export function TerminalSessionStart({
  currentBranch,
  currentGitHub,
  onOpenExternal,
  providers,
  worktree,
  onResumePrimarySession,
  onDetachPrimarySession,
  onResumeSuggestedSession,
  onCreateSessionForWorktree,
  onOpenWorktreeTerminal,
}: TerminalSessionStartProps) {
  const primarySession = worktree?.primarySessions[0];
  return (
    <main className="terminal-container">
      <TerminalBar
        currentBranch={currentBranch}
        currentGitHub={currentGitHub}
        onOpenExternal={onOpenExternal}
      />
      <div className="terminal-session-start">
        {worktree && (
          <div className="terminal-session-start-panel">
            {worktree.isMainWorktree ? (
              <OpenTerminalSection onOpen={onOpenWorktreeTerminal} />
            ) : primarySession ? (
              <ResumePrimarySection
                primarySession={primarySession}
                onResume={onResumePrimarySession}
                onDetach={onDetachPrimarySession}
              />
            ) : (
              <>
                {worktree.suggestedSessions.length > 0 && (
                  <div className="action-surface-section">
                    <div className="action-surface-label">Existing Session</div>
                    {worktree.suggestedSessions.map((suggestedSession) => (
                      <SuggestedSessionAction
                        key={suggestedSession.providerSessionKey}
                        suggestedSession={suggestedSession}
                        onSelect={() =>
                          onResumeSuggestedSession(suggestedSession.providerSessionKey)
                        }
                      />
                    ))}
                  </div>
                )}
                <div className="action-surface-section">
                  <div className="action-surface-label">New Session</div>
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
    </main>
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

interface ResumePrimarySectionProps {
  primarySession: PrimarySessionListItem;
  onResume: (providerSessionKey: string) => void;
  onDetach: (providerSessionKey: string) => void;
}

function ResumePrimarySection({ primarySession, onResume, onDetach }: ResumePrimarySectionProps) {
  const preview = primarySession.preview || "(no messages)";
  const providerName = providerLabel(primarySession.provider);
  const providerSessionKey = primarySession.providerSessionKey;
  const meta = [providerName, primarySession.state === "active" ? "active" : null]
    .filter((value) => value !== null)
    .join(" · ");
  return (
    <div className="action-surface-section">
      <div className="action-surface-label">Primary Session</div>
      <button
        type="button"
        className={`action-surface-row suggested-session-action resume-primary-action ${primarySession.state}`}
        onClick={() => {
          if (providerSessionKey) {
            onResume(providerSessionKey);
          }
        }}
        title={`Resume ${providerName}`}
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
          <span className="action-surface-row-meta">{meta}</span>
        </span>
      </button>
      {primarySession.state === "inactive" && providerSessionKey !== null && (
        <button
          type="button"
          className="action-surface-row new-session-action detach-primary-action"
          onClick={() => onDetach(providerSessionKey)}
          title={`Detach this ${providerName} session from the worktree`}
        >
          <Unlink size={14} strokeWidth={2} aria-hidden="true" />
          <span className="action-surface-row-text">
            <span className="action-surface-row-main">Detach session</span>
            <span className="action-surface-row-meta">
              Frees this worktree for another session. History is kept.
            </span>
          </span>
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
