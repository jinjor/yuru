import type { AgentDefinition } from "../../shared/agent";
import type {
  PrimarySessionListItem,
  RepoListItem,
  SuggestedSessionListItem,
  TaskWorktreeListItem,
} from "../../shared/metadata";
import { providerLabel } from "../utils/session";

interface RepoListProps {
  repos: RepoListItem[];
  providers: AgentDefinition[];
  selectedRuntimeSessionId: string | null;
  onCreateWorktreeSession: (repoPath: string) => void;
  onSelectRuntimeSession: (runtimeSessionId: string) => void;
  onResumePrimarySession: (taskWorktreeId: string, providerSessionKey: string) => void;
}

export function RepoList({
  repos,
  providers,
  selectedRuntimeSessionId,
  onCreateWorktreeSession,
  onSelectRuntimeSession,
  onResumePrimarySession,
}: RepoListProps) {
  if (repos.length === 0) {
    return <div className="repo-list-empty">No repositories</div>;
  }

  return (
    <div className="repo-list">
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
                  key={taskWorktree.taskWorktreeId}
                  taskWorktree={taskWorktree}
                  selectedRuntimeSessionId={selectedRuntimeSessionId}
                  onSelectRuntimeSession={onSelectRuntimeSession}
                  onResumePrimarySession={onResumePrimarySession}
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
  selectedRuntimeSessionId: string | null;
  onSelectRuntimeSession: (runtimeSessionId: string) => void;
  onResumePrimarySession: (taskWorktreeId: string, providerSessionKey: string) => void;
}

function TaskWorktreeCard({
  taskWorktree,
  selectedRuntimeSessionId,
  onSelectRuntimeSession,
  onResumePrimarySession,
}: TaskWorktreeCardProps) {
  const { primarySession, suggestedSessions } = taskWorktree;
  const isActive = primarySession?.state === "active";
  return (
    <div
      className={`task-worktree-card ${isActive ? "active" : "inactive"}`}
      title={taskWorktree.worktreePath}
    >
      <div className="task-worktree-header">
        <span className="task-worktree-name">{taskWorktree.name}</span>
      </div>
      <div className="task-worktree-body">
        {primarySession ? (
          <PrimarySessionItem
            taskWorktreeId={taskWorktree.taskWorktreeId}
            taskWorktreeName={taskWorktree.name}
            primarySession={primarySession}
            isSelected={
              selectedRuntimeSessionId !== null &&
              selectedRuntimeSessionId === primarySession.activeRuntimeSessionId
            }
            onSelectRuntimeSession={onSelectRuntimeSession}
            onResumePrimarySession={onResumePrimarySession}
          />
        ) : (
          <>
            {suggestedSessions.map((suggestedSession) => (
              <SuggestedSessionItem
                key={suggestedSession.providerSessionKey}
                taskWorktreeName={taskWorktree.name}
                suggestedSession={suggestedSession}
              />
            ))}
            <NewSessionItem taskWorktreeName={taskWorktree.name} />
          </>
        )}
      </div>
    </div>
  );
}

interface PrimarySessionItemProps {
  taskWorktreeId: string;
  taskWorktreeName: string;
  primarySession: PrimarySessionListItem;
  isSelected: boolean;
  onSelectRuntimeSession: (runtimeSessionId: string) => void;
  onResumePrimarySession: (taskWorktreeId: string, providerSessionKey: string) => void;
}

function PrimarySessionItem({
  taskWorktreeId,
  taskWorktreeName,
  primarySession,
  isSelected,
  onSelectRuntimeSession,
  onResumePrimarySession,
}: PrimarySessionItemProps) {
  const preview = primarySession.preview || "(no messages)";
  const providerName = providerLabel(primarySession.provider);
  return (
    <button
      type="button"
      className={`session-item primary ${isSelected ? "selected" : ""}`}
      onClick={() => {
        if (primarySession.activeRuntimeSessionId) {
          onSelectRuntimeSession(primarySession.activeRuntimeSessionId);
          return;
        }
        if (primarySession.providerSessionKey) {
          onResumePrimarySession(taskWorktreeId, primarySession.providerSessionKey);
        }
      }}
      aria-label={`Resume primary session for ${taskWorktreeName}`}
    >
      <span
        className={`session-provider-dot provider-${primarySession.provider} ${primarySession.state}`}
        title={`${providerName} · ${primarySession.state}`}
        aria-label={`${providerName} primary session ${primarySession.state}`}
      />
      <span className="session-item-text" title={preview}>
        {preview}
      </span>
    </button>
  );
}

interface SuggestedSessionItemProps {
  taskWorktreeName: string;
  suggestedSession: SuggestedSessionListItem;
}

interface NewSessionItemProps {
  taskWorktreeName: string;
}

function NewSessionItem({ taskWorktreeName }: NewSessionItemProps) {
  return (
    <div
      className="session-item new-session"
      aria-label={`New session for ${taskWorktreeName}`}
    >
      <span className="session-item-glyph" aria-hidden="true">
        +
      </span>
      <span className="session-item-text">New session</span>
    </div>
  );
}

function SuggestedSessionItem({ taskWorktreeName, suggestedSession }: SuggestedSessionItemProps) {
  const preview = suggestedSession.preview || "(no messages)";
  const providerName = providerLabel(suggestedSession.provider);
  return (
    <div
      className="session-item suggested"
      aria-label={`${providerName} suggested session for ${taskWorktreeName}`}
    >
      <span
        className={`session-provider-dot provider-${suggestedSession.provider} suggested`}
        title={`${providerName} · suggested`}
        aria-label={`${providerName} suggested session`}
      />
      <span className="session-item-text" title={preview}>
        {preview}
      </span>
    </div>
  );
}
