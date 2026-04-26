import type { RepoMetadata } from "../../shared/metadata";

interface RepoListProps {
  repos: RepoMetadata[];
}

export function RepoList({ repos }: RepoListProps) {
  if (repos.length === 0) {
    return <div className="repo-list-empty">No repositories</div>;
  }

  return (
    <div className="repo-list">
      {repos.map((repo) => (
        <div key={repo.id} className="repo-row" title={repo.repoPath}>
          <span className="repo-name">{repo.repoPath.split("/").pop() || repo.repoPath}</span>
          <span className="repo-path">{repo.repoPath}</span>
        </div>
      ))}
    </div>
  );
}
