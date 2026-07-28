import type { GitHubPullRequest } from "../../shared/session";

export function gitHubBadgeLabel(github: GitHubPullRequest): string {
  switch (github.state) {
    case "open":
      return `${github.isApproved ? "Approved" : "Open"} #${github.prNumber}`;
    case "draft":
      return `Draft #${github.prNumber}`;
    case "merged":
      return `Merged #${github.prNumber}`;
    case "closed":
      return `Closed #${github.prNumber}`;
  }
}
