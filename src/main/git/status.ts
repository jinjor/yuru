import type { GitLineStat, GitPathState } from "../../shared/ipc.js";
import { exec } from "../exec.js";
import { parseNumstatZ } from "./diff.js";
import { getUntrackedLineStats } from "./untracked-line-stats.js";

function normalizePorcelainStatus(status: string): string {
  return status === " " ? "" : status;
}

// git-status(1) の仕様で unmerged と定義されている XY の組み合わせ
const UNMERGED_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

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
      conflicted: false,
      ignored: true,
    };
  }

  if (rawStatus === "??") {
    return {
      path: filePath,
      indexStatus: "",
      worktreeStatus: "??",
      conflicted: false,
      ignored: false,
    };
  }

  if (UNMERGED_STATUSES.has(rawStatus)) {
    return {
      path: filePath,
      indexStatus: "",
      worktreeStatus: "",
      conflicted: true,
      ignored: false,
    };
  }

  return {
    path: filePath,
    indexStatus: normalizePorcelainStatus(rawStatus[0] ?? ""),
    worktreeStatus: normalizePorcelainStatus(rawStatus[1] ?? ""),
    conflicted: false,
    ignored: false,
  };
}

export async function getGitPathStates(cwd: string): Promise<GitPathState[]> {
  const [statusOutput, stagedNumstat, unstagedNumstat] = await Promise.all([
    exec("git", ["status", "--porcelain", "-uall"], cwd),
    exec("git", ["diff", "--numstat", "-z", "--cached"], cwd),
    exec("git", ["diff", "--numstat", "-z"], cwd),
  ]);

  if (!statusOutput.trim()) {
    return [];
  }

  const states = statusOutput
    .split("\n")
    .map(parsePorcelainLine)
    .filter((entry): entry is GitPathState => entry !== null);

  const stagedStats = parseNumstatZ(stagedNumstat);
  const unstagedStats = parseNumstatZ(unstagedNumstat);
  const untrackedPaths = states
    .filter((entry) => entry.worktreeStatus === "??")
    .map((entry) => entry.path);
  const hasConflicts = states.some((entry) => entry.conflicted);
  const [untrackedStats, conflictStats] = await Promise.all([
    getUntrackedLineStats(cwd, untrackedPaths),
    hasConflicts ? getHeadWorktreeLineStats(cwd) : new Map<string, GitLineStat>(),
  ]);

  for (const entry of states) {
    if (entry.conflicted) {
      const conflictLineStat = conflictStats.get(entry.path);
      if (conflictLineStat) {
        entry.conflictLineStat = conflictLineStat;
      }
      continue;
    }
    const stagedLineStat = stagedStats.get(entry.path);
    if (stagedLineStat) {
      entry.stagedLineStat = stagedLineStat;
    }
    const unstagedLineStat =
      entry.worktreeStatus === "??"
        ? untrackedStats.get(entry.path)
        : unstagedStats.get(entry.path);
    if (unstagedLineStat) {
      entry.unstagedLineStat = unstagedLineStat;
    }
  }

  return states;
}

// conflict 中の file は index が unmerged で staged/unstaged の行数が意味を持たないため、
// scope なし diff と同じ HEAD ↔ 作業ツリー の行数を別途取得する
async function getHeadWorktreeLineStats(cwd: string): Promise<Map<string, GitLineStat>> {
  const output = await exec("git", ["diff", "--numstat", "-z", "HEAD"], cwd);
  return parseNumstatZ(output);
}
