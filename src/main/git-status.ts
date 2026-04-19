import type { GitPathState } from "../shared/ipc";

function normalizePorcelainStatus(status: string): string {
  return status === " " ? "" : status;
}

export function parsePorcelainLine(line: string): GitPathState | null {
  if (!line) {
    return null;
  }

  const rawStatus = line.substring(0, 2);
  let filePath = line.substring(3).trim();

  if (!filePath) {
    return null;
  }

  if (filePath.includes(" -> ")) {
    const parts = filePath.split(" -> ");
    filePath = parts[parts.length - 1] ?? filePath;
  }

  filePath = filePath.replace(/\/$/, "");

  if (rawStatus === "!!") {
    return {
      path: filePath,
      indexStatus: "",
      worktreeStatus: "",
      ignored: true,
    };
  }

  if (rawStatus === "??") {
    return {
      path: filePath,
      indexStatus: "",
      worktreeStatus: "??",
      ignored: false,
    };
  }

  return {
    path: filePath,
    indexStatus: normalizePorcelainStatus(rawStatus[0] ?? ""),
    worktreeStatus: normalizePorcelainStatus(rawStatus[1] ?? ""),
    ignored: false,
  };
}
