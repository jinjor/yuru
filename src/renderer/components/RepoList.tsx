import { GitBranch } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { AgentDefinition } from "../../shared/agent";
import type {
  PrimarySessionListItem,
  RepoListItem,
  SuggestedSessionListItem,
  TaskWorktreeListItem,
} from "../../shared/metadata";
import type { RuntimeSessionId, SessionProvider } from "../../shared/session";
import { providerLabel } from "../utils/session";
import { GitHubBadge } from "./GitHubBadge";

interface RepoListProps {
  repos: RepoListItem[];
  providers: AgentDefinition[];
  selectedWorktreeId: string | null;
  onCreateWorktreeSession: (repoPath: string) => void;
  onSelectActiveSession: (worktreeId: string, runtimeSessionId: RuntimeSessionId) => void;
  onResumePrimarySession: (worktreeId: string, providerSessionKey: string) => void;
  onResumeSuggestedSession: (worktreeId: string, providerSessionKey: string) => void;
  onCreateSessionForWorktree: (worktreeId: string, provider: SessionProvider) => void;
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
          {repo.taskWorktrees.length > 0 && (
            <div className="repo-task-worktrees">
              {repo.taskWorktrees.map((taskWorktree) => (
                <TaskWorktreeCard
                  key={taskWorktree.worktreeId}
                  taskWorktree={taskWorktree}
                  providers={providers}
                  selectedWorktreeId={selectedWorktreeId}
                  isActionSurfaceOpen={openActionWorktreeId === taskWorktree.worktreeId}
                  onCloseActionSurface={() => setOpenActionWorktreeId(null)}
                  onToggleActionSurface={() => {
                    setOpenActionWorktreeId((prev) =>
                      prev === taskWorktree.worktreeId
                        ? null
                        : taskWorktree.worktreeId,
                    );
                  }}
                  onSelectActiveSession={onSelectActiveSession}
                  onResumePrimarySession={onResumePrimarySession}
                  onResumeSuggestedSession={onResumeSuggestedSession}
                  onCreateSessionForWorktree={onCreateSessionForWorktree}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface TaskWorktreeCardProps {
  taskWorktree: TaskWorktreeListItem;
  providers: AgentDefinition[];
  selectedWorktreeId: string | null;
  isActionSurfaceOpen: boolean;
  onCloseActionSurface: () => void;
  onToggleActionSurface: () => void;
  onSelectActiveSession: (worktreeId: string, runtimeSessionId: RuntimeSessionId) => void;
  onResumePrimarySession: (worktreeId: string, providerSessionKey: string) => void;
  onResumeSuggestedSession: (worktreeId: string, providerSessionKey: string) => void;
  onCreateSessionForWorktree: (worktreeId: string, provider: SessionProvider) => void;
}

function TaskWorktreeCard({
  taskWorktree,
  providers,
  selectedWorktreeId,
  isActionSurfaceOpen,
  onCloseActionSurface,
  onToggleActionSurface,
  onSelectActiveSession,
  onResumePrimarySession,
  onResumeSuggestedSession,
  onCreateSessionForWorktree,
}: TaskWorktreeCardProps) {
  const { primarySession, suggestedSessions } = taskWorktree;
  const isSelected = selectedWorktreeId === taskWorktree.worktreeId;
  const isPrimarySessionActive = isSelected || primarySession?.state === "active";

  const selectPrimarySession = () => {
    if (!primarySession) {
      return;
    }
    if (primarySession.activeRuntimeSessionId) {
      onSelectActiveSession(taskWorktree.worktreeId, primarySession.activeRuntimeSessionId);
      return;
    }
    if (primarySession.providerSessionKey) {
      onResumePrimarySession(taskWorktree.worktreeId, primarySession.providerSessionKey);
    }
  };

  const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (primarySession) {
      onCloseActionSurface();
      selectPrimarySession();
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
      title={taskWorktree.worktreePath}
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <div className="task-worktree-summary">
        <span className="task-worktree-heading">
          <span className="task-worktree-name" title={worktreeLabelText(taskWorktree)}>
            {renderWorktreeLabel(taskWorktree)}
          </span>
          {taskWorktree.githubPullRequest && (
            <GitHubBadge github={taskWorktree.githubPullRequest} />
          )}
        </span>
        {primarySession ? (
          <PrimarySessionSummary
            isActive={isPrimarySessionActive}
            primarySession={primarySession}
          />
        ) : (
          <span className="task-worktree-hint">{formatExistingSessionCount(suggestedSessions.length)}</span>
        )}
      </div>
      {!primarySession && isActionSurfaceOpen && (
        <TaskWorktreeActionSurface
          worktreeId={taskWorktree.worktreeId}
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
              <span
                className={`session-provider-dot provider-${provider.id}`}
                aria-hidden="true"
              />
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
  const meta = [
    providerName,
    isActive ? "active" : null,
    timestamp,
  ].filter((value) => value !== null && value !== "").join(" · ");
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

function worktreeLabelText(taskWorktree: TaskWorktreeListItem): string {
  if (taskWorktree.branch) {
    return taskWorktree.branch;
  }
  return `(detached @ ${taskWorktree.headSha.slice(0, 7)})`;
}

function renderWorktreeLabel(taskWorktree: TaskWorktreeListItem): ReactNode {
  const text = worktreeLabelText(taskWorktree);
  if (!taskWorktree.branch) {
    return text;
  }
  return (
    <>
      <GitBranch className="task-worktree-branch-icon" size={12} strokeWidth={2} aria-hidden="true" />
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
