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
  WorktreeSessionState,
} from "../../shared/metadata";
import type { AgentActivityState, TerminalRuntimeId, SessionProvider } from "../../shared/session";
import { providerLabel } from "../utils/session";
import { GitHubBadge } from "./GitHubBadge";

interface RepoListProps {
  repos: RepoListItem[];
  activityStates: ReadonlyMap<TerminalRuntimeId, AgentActivityState>;
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
  activityStates,
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
              activityStates={activityStates}
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
                activityStates={activityStates}
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
  activityStates: ReadonlyMap<TerminalRuntimeId, AgentActivityState>;
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
  activityStates,
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
            activityStates={activityStates}
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
          activityStates={activityStates}
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
  activityStates: ReadonlyMap<TerminalRuntimeId, AgentActivityState>;
}

function PrimarySessionSummary({
  isActive,
  primarySession,
  activityStates,
}: PrimarySessionSummaryProps) {
  const preview = primarySession.preview || "(no messages)";
  const state = isActive ? "active" : primarySession.state;
  const activityState = sessionActivityState(primarySession, activityStates);
  return (
    <span className="task-worktree-session-row">
      <SessionProviderDot
        kind="primary"
        provider={primarySession.provider}
        state={state}
        activityState={activityState}
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
  activityStates: ReadonlyMap<TerminalRuntimeId, AgentActivityState>;
  onResumeSuggestedSession: (worktreeId: string, providerSessionKey: string) => void;
  onCreateSessionForWorktree: (worktreeId: string, provider: SessionProvider) => void;
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
}

function TaskWorktreeActionSurface({
  worktreeId,
  providers,
  suggestedSessions,
  activityStates,
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
              activityStates={activityStates}
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
  activityStates: ReadonlyMap<TerminalRuntimeId, AgentActivityState>;
  onSelect: () => void;
}

function SuggestedSessionAction({
  suggestedSession,
  activityStates,
  onSelect,
}: SuggestedSessionActionProps) {
  const preview = suggestedSession.preview || "(no messages)";
  const providerName = providerLabel(suggestedSession.provider);
  const isActive = suggestedSession.state === "active";
  const activityState = sessionActivityState(suggestedSession, activityStates);
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

interface SessionProviderDotProps {
  kind: "primary" | "suggested";
  provider: SessionProvider;
  state: WorktreeSessionState;
  activityState: AgentActivityState;
}

function sessionActivityState(
  session: {
    activeTerminalRuntimeId: TerminalRuntimeId | null;
    activityState: AgentActivityState;
  },
  activityStates: ReadonlyMap<TerminalRuntimeId, AgentActivityState>,
): AgentActivityState {
  return session.activeTerminalRuntimeId
    ? (activityStates.get(session.activeTerminalRuntimeId) ?? session.activityState)
    : session.activityState;
}

function SessionProviderDot({ kind, provider, state, activityState }: SessionProviderDotProps) {
  const activityClass = state === "active" ? `activity-${activityState}` : "";
  const stateLabel = state === "active" ? `${state} · ${activityState}` : state;
  const providerName = providerLabel(provider);
  const kindLabel = kind === "suggested" ? "suggested session" : "primary session";
  const title =
    kind === "suggested"
      ? `${providerName} · suggested · ${stateLabel}`
      : `${providerName} · ${stateLabel}`;

  return (
    <span
      className={[
        "session-provider-dot",
        `provider-${provider}`,
        kind === "suggested" ? "suggested" : "",
        state,
        activityClass,
      ]
        .filter(Boolean)
        .join(" ")}
      title={title}
      aria-label={`${providerName} ${kindLabel} ${stateLabel}`}
    />
  );
}

function worktreeLabelText(worktree: WorktreeListItem): string {
  if (!worktree.headSha) {
    return "(no commits)";
  }
  if (worktree.branch) {
    return worktree.branch;
  }
  return `detached @ ${worktree.headSha.slice(0, 7)}`;
}

function renderWorktreeLabel(worktree: WorktreeListItem): ReactNode {
  const text = worktreeLabelText(worktree);
  if (!worktree.branch || !worktree.headSha) {
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
