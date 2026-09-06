import type { GitHubItem } from "../../shared/session";

export function gitHubBadgeLabel(item: GitHubItem): string {
  if (item.kind === "issue") {
    return `${item.state === "open" ? "Open" : "Closed"} #${item.number}`;
  }
  switch (item.state) {
    case "open":
      return `${item.isApproved ? "Approved" : "Open"} #${item.number}`;
    case "draft":
      return `Draft #${item.number}`;
    case "merged":
      return `Merged #${item.number}`;
    case "closed":
      return `Closed #${item.number}`;
  }
}
