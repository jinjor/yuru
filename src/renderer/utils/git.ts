import type { GitFileStatus, GitPathState } from "../../shared/ipc";

function statusPriority(status: string): number {
  switch (status) {
    case "A":
    case "R":
    case "??":
      return 3;
    case "M":
      return 2;
    case "D":
      return 1;
    default:
      return 0;
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case "M":
      return "#e2c08d";
    case "A":
    case "R":
    case "??":
      return "#73c991";
    case "D":
      return "#c74e39";
    default:
      return "#888";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "??":
      return "U";
    default:
      return status;
  }
}

export function treeStatusClass(status?: string): string {
  switch (status) {
    case "M":
      return "modified";
    case "A":
    case "R":
    case "??":
      return "added";
    default:
      return "";
  }
}

export function buildChangedFiles(pathStates: readonly GitPathState[]): GitFileStatus[] {
  return pathStates
    .filter((entry) => !entry.ignored && entry.status)
    .map((entry) => ({
      path: entry.path,
      status: entry.status,
    }));
}

export function buildTreeStatusMap(pathStates: readonly GitPathState[]): Map<string, string> {
  const statuses = new Map<string, string>();

  for (const entry of pathStates) {
    if (entry.ignored || !entry.status) {
      continue;
    }

    const segments = entry.path.split("/");
    for (let i = 1; i <= segments.length; i++) {
      const nextPath = segments.slice(0, i).join("/");
      const existing = statuses.get(nextPath);
      if (!existing || statusPriority(entry.status) > statusPriority(existing)) {
        statuses.set(nextPath, entry.status);
      }
    }
  }

  return statuses;
}

export function buildIgnoredPathSet(pathStates: readonly GitPathState[]): Set<string> {
  const ignoredPaths = new Set<string>();

  for (const entry of pathStates) {
    if (!entry.ignored) {
      continue;
    }

    const segments = entry.path.split("/");
    for (let i = 1; i <= segments.length; i++) {
      ignoredPaths.add(segments.slice(0, i).join("/"));
    }
  }

  return ignoredPaths;
}
