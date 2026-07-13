import { type MouseEvent as ReactMouseEvent } from "react";
import { GitPullRequest } from "lucide-react";
import type { GitHubPullRequest } from "../../shared/session";

interface GitHubBadgeProps {
  github: GitHubPullRequest;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

export function GitHubBadge({ github, onClick }: GitHubBadgeProps) {
  if (onClick) {
    return (
      <button
        type="button"
        className={`${gitHubBadgeClass(github)} interactive`}
        onClick={onClick}
        title={github.url}
      >
        <GitPullRequest size={11} strokeWidth={2} aria-hidden="true" />
        {gitHubBadgeLabel(github)}
      </button>
    );
  }

  return (
    <span className={gitHubBadgeClass(github)} title={github.url}>
      <GitPullRequest size={11} strokeWidth={2} aria-hidden="true" />
      {gitHubBadgeLabel(github)}
    </span>
  );
}

function gitHubBadgeLabel(github: GitHubPullRequest): string {
  switch (github.state) {
    case "open":
      return `Open #${github.prNumber}`;
    case "draft":
      return `Draft #${github.prNumber}`;
    case "merged":
      return `Merged #${github.prNumber}`;
    case "closed":
      return `Closed #${github.prNumber}`;
  }
}

function gitHubBadgeClass(github: GitHubPullRequest): string {
  return `github-badge ${github.state}`;
}
