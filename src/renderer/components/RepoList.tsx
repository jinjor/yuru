import type { AgentDefinition } from "../../shared/agent";
import type { RepoListItem } from "../../shared/metadata";
import { providerLabel } from "../utils/session";

interface RepoListProps {
  repos: RepoListItem[];
  providers: AgentDefinition[];
  selectedPrimarySessionKey: string | null;
  onCreateWorktreeSession: (repoPath: string) => void;
  onSelectPrimarySession: (taskWorktreeId: string, providerSessionKey: string) => void;
}

export function RepoList({
  repos,
  providers,
  selectedPrimarySessionKey,
  onCreateWorktreeSession,
  onSelectPrimarySession,
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
              {repo.taskWorktrees.map((taskWorktree) => {
                const primarySession = taskWorktree.primarySession;
                if (!primarySession) {
                  return (
                    <div
                      key={taskWorktree.taskWorktreeId}
                      className="repo-task-worktree-row empty"
                      title={taskWorktree.worktreePath}
                      aria-label={`Worktree ${taskWorktree.name}`}
                    >
                      <span className="repo-task-worktree-empty-glyph" aria-hidden="true">
                        +
                      </span>
                      <span className="repo-task-worktree-name">{taskWorktree.name}</span>
                    </div>
                  );
                }
                const preview = primarySession.preview || "(no messages)";
                const providerName = providerLabel(primarySession.provider);
                return (
                  <button
                    key={taskWorktree.taskWorktreeId}
                    type="button"
                    className={`repo-task-worktree-row ${selectedPrimarySessionKey === primarySession.providerSessionKey ? "selected" : ""}`}
                    onClick={() =>
                      onSelectPrimarySession(
                        taskWorktree.taskWorktreeId,
                        primarySession.providerSessionKey,
                      )
                    }
                    title={taskWorktree.worktreePath}
                    aria-label={`Resume primary session for ${taskWorktree.name}`}
                  >
                    <span
                      className={`session-provider-dot provider-${primarySession.provider} ${primarySession.state}`}
                      title={`${providerName} · ${primarySession.state}`}
                      aria-label={`${providerName} primary session ${primarySession.state}`}
                    />
                    <span className="repo-task-worktree-text">
                      <span className="repo-task-worktree-name">{taskWorktree.name}</span>
                      <span className="repo-task-worktree-preview" title={preview}>
                        {preview}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
