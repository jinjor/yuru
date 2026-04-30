import type { AgentDefinition } from "../../shared/agent";
import type { RepoMetadata } from "../../shared/metadata";

interface RepoListProps {
  repos: RepoMetadata[];
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
        <div key={repo.id} className="repo-row" title={repo.repoPath}>
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
      ))}
    </div>
  );
}
