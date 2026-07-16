import { Terminal as TerminalIcon } from "lucide-react";
import type { AgentDefinition } from "../../shared/agent";
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
  providers: AgentDefinition[];
  worktree: WorktreeListItem | null;
  onResumePrimarySession: (worktreeId: string, providerSessionKey: string) => void;
  onResumeSuggestedSession: (worktreeId: string, providerSessionKey: string) => void;
  onCreateSessionForWorktree: (worktreeId: string, provider: SessionProvider) => void;
  onOpenWorktreeTerminal: (worktreeId: string) => void;
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
  onResumeSuggestedSession,
  onCreateSessionForWorktree,
  onOpenWorktreeTerminal,
}: TerminalSessionStartProps) {
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
              <OpenTerminalSection onOpen={() => onOpenWorktreeTerminal(worktree.worktreeId)} />
            ) : worktree.primarySession ? (
              <ResumePrimarySection
                primarySession={worktree.primarySession}
                onResume={(providerSessionKey) =>
                  onResumePrimarySession(worktree.worktreeId, providerSessionKey)
                }
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
                          onResumeSuggestedSession(
                            worktree.worktreeId,
                            suggestedSession.providerSessionKey,
                          )
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
                        key={provider.id}
                        className="action-surface-row new-session-action"
                        onClick={() => onCreateSessionForWorktree(worktree.worktreeId, provider.id)}
                        title={`Start new ${provider.label} session`}
                      >
                        <span
                          className={`session-provider-dot provider-${provider.id}`}
                          aria-hidden="true"
                        />
                        <span className="action-surface-row-main">{provider.label}</span>
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
}

function ResumePrimarySection({ primarySession, onResume }: ResumePrimarySectionProps) {
  const preview = primarySession.preview || "(no messages)";
  const providerName = providerLabel(primarySession.provider);
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
          if (primarySession.providerSessionKey) {
            onResume(primarySession.providerSessionKey);
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
