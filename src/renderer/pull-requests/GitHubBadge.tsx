import { type MouseEvent as ReactMouseEvent } from "react";
import { GitPullRequest } from "lucide-react";
import type { GitHubPullRequest } from "../../shared/session";
import { gitHubBadgeLabel } from "./githubBadgeLabel";

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

function gitHubBadgeClass(github: GitHubPullRequest): string {
  return `github-badge ${github.state}`;
}
