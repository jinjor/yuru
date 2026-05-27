import { GitBranch } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { AgentDefinition } from "../../shared/agent";
import type {
  PrimarySessionListItem,
  RepoListItem,
  SuggestedSessionListItem,
  WorktreeListItem,
} from "../../shared/metadata";
import type { TerminalRuntimeId, SessionProvider } from "../../shared/session";
import { providerLabel } from "../utils/session";
import { GitHubBadge } from "./GitHubBadge";

interface RepoListProps {
  repos: RepoListItem[];
  providers: AgentDefinition[];
  selectedWorktreeId: string | null;
  onCreateWorktreeSession: (repoPath: string) => void;
  onSelectActiveSession: (worktreeId: string, terminalRuntimeId: TerminalRuntimeId) => void;
  onResumePrimarySession: (worktreeId: string, providerSessionKey: string) => void;
  onResumeSuggestedSession: (worktreeId: string, providerSessionKey: string) => void;
  onCreateSessionForWorktree: (worktreeId: string, provider: SessionProvider) => void;
  onOpenWorktreeTerminal: (worktreeId: string) => void;
}

export function RepoList({
  repos,
  providers,
  selectedWorktreeId,
  onCreateWorktreeSession,
  onSelectActiveSession,
  onResumePrimarySession,
  onResumeSuggestedSession,
  onCreateSessionForWorktree,
  onOpenWorktreeTerminal,
}: RepoListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [openActionWorktreeId, setOpenActionWorktreeId] = useState<string | null>(null);

  useEffect(() => {
    if (!openActionWorktreeId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (listRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpenActionWorktreeId(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openActionWorktreeId]);

  if (repos.length === 0) {
    return <div className="repo-list-empty">No repositories</div>;
  }

  return (
    <div ref={listRef} className="repo-list" onClick={() => setOpenActionWorktreeId(null)}>
      {repos.map((repo) => (
        <div key={repo.id} className="repo-group">
          <div className="repo-row" title={repo.repoPath}>
            <div className="repo-row-text">
              <span className="repo-name">{repo.repoPath.split("/").pop() || repo.repoPath}</span>
              <span className="repo-path">{repo.repoPath}</span>
            </div>
            <button
              className="repo-row-new-btn"
              onClick={() => onCreateWorktreeSession(repo.repoPath)}
              disabled={providers.length === 0}
              title={providers.length === 0 ? "No agents available" : "New worktree session"}
            >
              +
            </button>
          </div>
          <div className="repo-task-worktrees">
            <WorktreeCard
              key={repo.mainWorktree.worktreeId}
              worktree={repo.mainWorktree}
              providers={providers}
              selectedWorktreeId={selectedWorktreeId}
              isActionSurfaceOpen={false}
              onCloseActionSurface={() => setOpenActionWorktreeId(null)}
              onToggleActionSurface={() => undefined}
              onSelectActiveSession={onSelectActiveSession}
              onResumePrimarySession={onResumePrimarySession}
              onResumeSuggestedSession={onResumeSuggestedSession}
              onCreateSessionForWorktree={onCreateSessionForWorktree}
              onOpenWorktreeTerminal={onOpenWorktreeTerminal}
            />
            {repo.taskWorktrees.map((taskWorktree) => (
              <WorktreeCard
                key={taskWorktree.worktreeId}
                worktree={taskWorktree}
                providers={providers}
                selectedWorktreeId={selectedWorktreeId}
                isActionSurfaceOpen={openActionWorktreeId === taskWorktree.worktreeId}
                onCloseActionSurface={() => setOpenActionWorktreeId(null)}
                onToggleActionSurface={() => {
                  setOpenActionWorktreeId((prev) =>
                    prev === taskWorktree.worktreeId ? null : taskWorktree.worktreeId,
                  );
                }}
                onSelectActiveSession={onSelectActiveSession}
                onResumePrimarySession={onResumePrimarySession}
                onResumeSuggestedSession={onResumeSuggestedSession}
                onCreateSessionForWorktree={onCreateSessionForWorktree}
                onOpenWorktreeTerminal={onOpenWorktreeTerminal}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface WorktreeCardProps {
  worktree: WorktreeListItem;
  providers: AgentDefinition[];
  selectedWorktreeId: string | null;
  isActionSurfaceOpen: boolean;
  onCloseActionSurface: () => void;
  onToggleActionSurface: () => void;
  onSelectActiveSession: (worktreeId: string, terminalRuntimeId: TerminalRuntimeId) => void;
  onResumePrimarySession: (worktreeId: string, providerSessionKey: string) => void;
  onResumeSuggestedSession: (worktreeId: string, providerSessionKey: string) => void;
  onCreateSessionForWorktree: (worktreeId: string, provider: SessionProvider) => void;
  onOpenWorktreeTerminal: (worktreeId: string) => void;
}

function WorktreeCard({
  worktree,
  providers,
  selectedWorktreeId,
  isActionSurfaceOpen,
  onCloseActionSurface,
  onToggleActionSurface,
  onSelectActiveSession,
  onResumePrimarySession,
  onResumeSuggestedSession,
  onCreateSessionForWorktree,
  onOpenWorktreeTerminal,
}: WorktreeCardProps) {
  const { primarySession, suggestedSessions } = worktree;
  const isSelected = selectedWorktreeId === worktree.worktreeId;
  const isPrimarySessionActive = isSelected || primarySession?.state === "active";
  const opensStandaloneTerminal = worktree.isMainWorktree === true;

  const selectPrimarySession = () => {
    if (!primarySession) {
      return;
    }
    if (primarySession.activeTerminalRuntimeId) {
      onSelectActiveSession(worktree.worktreeId, primarySession.activeTerminalRuntimeId);
      return;
    }
    if (primarySession.providerSessionKey) {
      onResumePrimarySession(worktree.worktreeId, primarySession.providerSessionKey);
    }
  };

  const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (primarySession) {
      onCloseActionSurface();
      selectPrimarySession();
      return;
    }
    if (opensStandaloneTerminal) {
      onCloseActionSurface();
      onOpenWorktreeTerminal(worktree.worktreeId);
      return;
    }
    onToggleActionSurface();
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    if (primarySession) {
      onCloseActionSurface();
      selectPrimarySession();
      return;
    }
    if (opensStandaloneTerminal) {
      onCloseActionSurface();
      onOpenWorktreeTerminal(worktree.worktreeId);
      return;
    }
    onToggleActionSurface();
  };

  return (
    <div
      className={[
        "task-worktree-card",
        primarySession ? "has-primary" : "no-primary",
        isPrimarySessionActive ? "active" : "inactive",
        isSelected ? "selected" : "",
        isActionSurfaceOpen ? "action-open" : "",
      ].join(" ")}
      title={worktree.worktreePath}
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <div className="task-worktree-summary">
        <span className="task-worktree-heading">
          <span className="task-worktree-name" title={worktreeLabelText(worktree)}>
            {renderWorktreeLabel(worktree)}
          </span>
          {worktree.githubPullRequest && <GitHubBadge github={worktree.githubPullRequest} />}
        </span>
        {primarySession ? (
          <PrimarySessionSummary
            isActive={isPrimarySessionActive}
            primarySession={primarySession}
          />
        ) : (
          <span className="task-worktree-hint">
            {opensStandaloneTerminal
              ? "terminal"
              : formatExistingSessionCount(suggestedSessions.length)}
          </span>
        )}
      </div>
      {!primarySession && !opensStandaloneTerminal && isActionSurfaceOpen && (
        <TaskWorktreeActionSurface
          worktreeId={worktree.worktreeId}
          providers={providers}
          suggestedSessions={suggestedSessions}
          onResumeSuggestedSession={onResumeSuggestedSession}
          onCreateSessionForWorktree={onCreateSessionForWorktree}
          onClick={(event) => event.stopPropagation()}
        />
      )}
    </div>
  );
}

interface PrimarySessionSummaryProps {
  isActive: boolean;
  primarySession: PrimarySessionListItem;
}

function PrimarySessionSummary({ isActive, primarySession }: PrimarySessionSummaryProps) {
  const preview = primarySession.preview || "(no messages)";
  const providerName = providerLabel(primarySession.provider);
  const state = isActive ? "active" : primarySession.state;
  return (
    <span className="task-worktree-session-row">
      <span
        className={`session-provider-dot provider-${primarySession.provider} ${state}`}
        title={`${providerName} · ${state}`}
        aria-label={`${providerName} primary session ${state}`}
      />
      <span className="task-worktree-session-preview" title={preview}>
        {preview}
      </span>
    </span>
  );
}

interface TaskWorktreeActionSurfaceProps {
  worktreeId: string;
  providers: AgentDefinition[];
  suggestedSessions: SuggestedSessionListItem[];
  onResumeSuggestedSession: (worktreeId: string, providerSessionKey: string) => void;
  onCreateSessionForWorktree: (worktreeId: string, provider: SessionProvider) => void;
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
}

function TaskWorktreeActionSurface({
  worktreeId,
  providers,
  suggestedSessions,
  onResumeSuggestedSession,
  onCreateSessionForWorktree,
  onClick,
}: TaskWorktreeActionSurfaceProps) {
  return (
    <div className="task-worktree-action-surface" onClick={onClick}>
      {suggestedSessions.length > 0 && (
        <div className="action-surface-section">
          <div className="action-surface-label">Existing Session</div>
          {suggestedSessions.map((suggestedSession) => (
            <SuggestedSessionAction
              key={suggestedSession.providerSessionKey}
              suggestedSession={suggestedSession}
              onSelect={() =>
                onResumeSuggestedSession(worktreeId, suggestedSession.providerSessionKey)
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
              onClick={() => onCreateSessionForWorktree(worktreeId, provider.id)}
              title={`Start new ${provider.label} session`}
            >
              <span className={`session-provider-dot provider-${provider.id}`} aria-hidden="true" />
              <span className="action-surface-row-main">{provider.label}</span>
            </button>
          ))}
        </div>
      </div>
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
      <span
        className={`session-provider-dot provider-${suggestedSession.provider} suggested ${suggestedSession.state}`}
        title={`${providerName} · suggested · ${suggestedSession.state}`}
        aria-label={`${providerName} suggested session ${suggestedSession.state}`}
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

function worktreeLabelText(worktree: WorktreeListItem): string {
  if (worktree.branch) {
    return worktree.branch;
  }
  if (!worktree.headSha) {
    return "(no commits)";
  }
  return `detached @ ${worktree.headSha.slice(0, 7)}`;
}

function renderWorktreeLabel(worktree: WorktreeListItem): ReactNode {
  const text = worktreeLabelText(worktree);
  if (!worktree.branch) {
    return text;
  }
  return (
    <>
      <GitBranch
        className="task-worktree-branch-icon"
        size={12}
        strokeWidth={2}
        aria-hidden="true"
      />
      {text}
    </>
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

function formatExistingSessionCount(count: number): string {
  if (count === 0) {
    return "empty";
  }
  return `${count} existing session${count === 1 ? "" : "s"}`;
}
