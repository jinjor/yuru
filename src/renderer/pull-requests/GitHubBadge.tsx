import { type MouseEvent as ReactMouseEvent } from "react";
import { CircleDot, GitPullRequest } from "lucide-react";
import type { GitHubItem } from "../../shared/session";
import { gitHubBadgeLabel } from "./githubBadgeLabel";

interface GitHubBadgeProps {
  item: GitHubItem;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

// GitHub の Issue / PR の状態バッジ。アイコンが種別を、色とラベルが状態を表す。
export function GitHubBadge({ item, onClick }: GitHubBadgeProps) {
  const Icon = item.kind === "issue" ? CircleDot : GitPullRequest;
  const className = `github-badge ${item.kind} ${item.state}`;

  if (onClick) {
    return (
      <button
        type="button"
        className={`${className} interactive`}
        onClick={onClick}
        title={item.url}
      >
        <Icon size={11} strokeWidth={2} aria-hidden="true" />
        {gitHubBadgeLabel(item)}
      </button>
    );
  }

  return (
    <span className={className} title={item.url}>
      <Icon size={11} strokeWidth={2} aria-hidden="true" />
      {gitHubBadgeLabel(item)}
    </span>
  );
}
