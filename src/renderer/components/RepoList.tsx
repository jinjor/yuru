import type { AgentDefinition } from "../../shared/agent";
import type { RepoListItem } from "../../shared/metadata";

interface RepoListProps {
  repos: RepoListItem[];
  providers: AgentDefinition[];
  onCreateWorktreeSession: (repoPath: string) => void;
}

export function RepoList({ repos, providers, onCreateWorktreeSession }: RepoListProps) {
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
          {repo.taskWorktrees.some((taskWorktree) => taskWorktree.primarySession) && (
            <div className="repo-task-worktrees">
              {repo.taskWorktrees.map((taskWorktree) => {
                const primarySession = taskWorktree.primarySession;
                if (!primarySession) {
                  return null;
                }
                return (
                  <div
                    key={taskWorktree.taskWorktreeId}
                    className="repo-task-worktree-row"
                    title={taskWorktree.worktreePath}
                  >
                    <span
                      className={`repo-task-worktree-state-dot ${primarySession.state}`}
                      title={`Primary session · ${primarySession.state}`}
                      aria-label={`Primary session ${primarySession.state}`}
                    />
                    <span className="repo-task-worktree-name">{taskWorktree.name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
