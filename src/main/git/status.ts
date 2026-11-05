import type { GitLineStat, GitPathState } from "../../shared/ipc.js";
import { exec } from "../exec.js";
import { parseNumstatZ } from "./diff.js";
import { getHeadSha } from "./repo.js";
import { getUntrackedLineStats } from "./untracked-line-stats.js";

function normalizePorcelainStatus(status: string): string {
  return status === " " ? "" : status;
}

// git-status(1) の仕様で unmerged と定義されている XY の組み合わせ
const UNMERGED_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function parsePorcelainEntry(rawStatus: string, path: string): GitPathState {
  const filePath = path.replace(/\/$/, "");

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

// `git status --porcelain -z` の出力を解釈する。-z ではパスがクォートされず、
// rename/copy は "XY 移動先\0移動元\0" の形になる
export function parsePorcelainZ(output: string): GitPathState[] {
  const fields = output.split("\0");
  const states: GitPathState[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";
    if (field.length < 4) {
      continue;
    }
    const rawStatus = field.substring(0, 2);
    states.push(parsePorcelainEntry(rawStatus, field.substring(3)));
    if (rawStatus.includes("R") || rawStatus.includes("C")) {
      i++;
    }
  }
  return states;
}

export async function getGitPathStates(cwd: string): Promise<GitPathState[]> {
  const [statusOutput, stagedNumstat, unstagedNumstat] = await Promise.all([
    exec("git", ["status", "--porcelain", "-z", "-uall", "--ignored=matching"], cwd),
    exec("git", ["diff", "--numstat", "-z", "--cached"], cwd),
    exec("git", ["diff", "--numstat", "-z"], cwd),
  ]);

  const states = parsePorcelainZ(statusOutput);

  const stagedStats = parseNumstatZ(stagedNumstat);
  const unstagedStats = parseNumstatZ(unstagedNumstat);
  const untrackedPaths = states
    .filter((entry) => entry.worktreeStatus === "??")
    .map((entry) => entry.path);
  const needsCombinedStats = states.some(
    (entry) => entry.conflicted || (entry.indexStatus && entry.worktreeStatus),
  );
  const [untrackedStats, headWorktreeStats] = await Promise.all([
    getUntrackedLineStats(cwd, untrackedPaths),
    needsCombinedStats
      ? getHeadWorktreeLineStats(
          cwd,
          states.map((entry) => entry.path),
        )
      : new Map<string, GitLineStat>(),
  ]);

  for (const entry of states) {
    if (entry.conflicted) {
      const conflictLineStat = headWorktreeStats.get(entry.path);
      if (conflictLineStat) {
        entry.conflictLineStat = conflictLineStat;
      }
      continue;
    }
    if (entry.indexStatus && entry.worktreeStatus) {
      entry.combinedLineStat = headWorktreeStats.get(entry.path);
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

// conflict 中、または staged / unstaged の両方に変更がある場合は、
// scope なし diff と同じ HEAD ↔ 作業ツリーの行数を取得する。
async function getHeadWorktreeLineStats(
  cwd: string,
  paths: string[],
): Promise<Map<string, GitLineStat>> {
  if (!(await getHeadSha(cwd))) {
    return getUntrackedLineStats(cwd, paths);
  }
  const output = await exec("git", ["diff", "--numstat", "-z", "HEAD"], cwd);
  return parseNumstatZ(output);
}
