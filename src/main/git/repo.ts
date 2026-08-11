import path from "path";
import { exec } from "../exec.js";

export interface GitReviewBase {
  branch: string;
  mergeBase: string;
}

const DEFAULT_BRANCH_CANDIDATES = ["main", "master"];

async function getReviewBaseSha(cwd: string, branch: string): Promise<string | null> {
  try {
    const output = await exec(
      "git",
      ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`],
      cwd,
    );
    return output.trim() || null;
  } catch (error) {
    if (isExitCode(error, 128)) {
      return null;
    }
    throw error;
  }
}

function isExitCode(error: unknown, code: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function resolveDefaultBranch(cwd: string): Promise<{ branch: string; sha: string } | null> {
  for (const branch of DEFAULT_BRANCH_CANDIDATES) {
    const sha = await getReviewBaseSha(cwd, branch);
    if (sha) {
      return { branch, sha };
    }
  }
  return null;
}

// Review の基準は local の default branch に固定する。remote-tracking ref は見ないので、
// clone の仕方や fetch の状況に左右されない。stacked branch でも parent を推測せず、
// default branch からの全差分として表示する。
export async function resolveGitReviewBase(cwd: string): Promise<GitReviewBase | null> {
  const [head, base] = await Promise.all([getHeadSha(cwd), resolveDefaultBranch(cwd)]);
  if (!head || !base) {
    return null;
  }

  try {
    const mergeBase = (await exec("git", ["merge-base", base.sha, head], cwd)).trim();
    return { branch: base.branch, mergeBase };
  } catch (error) {
    // 履歴が繋がらない branch 同士では merge-base が 1 で終わる
    if (isExitCode(error, 1)) {
      return null;
    }
    throw error;
  }
}

export async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const output = await exec("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
    const branch = output.trim();
    return branch || null;
  } catch {
    return null;
  }
}

export async function getHeadSha(cwd: string): Promise<string | null> {
  try {
    const output = await exec("git", ["rev-parse", "HEAD"], cwd);
    return output.trim() || null;
  } catch {
    return null;
  }
}

export async function getHeadCommittedAt(cwd: string): Promise<number | null> {
  try {
    const output = await exec("git", ["show", "-s", "--format=%ct", "HEAD"], cwd);
    return Number(output.trim()) * 1000;
  } catch {
    return null;
  }
}

export async function getRepoRootForProject(cwd: string): Promise<string | null> {
  try {
    const commonDir = await exec("git", ["rev-parse", "--git-common-dir"], cwd);
    const resolvedCommonDir = path.resolve(cwd, commonDir.trim());
    return path.dirname(resolvedCommonDir);
  } catch {
    return null;
  }
}

export async function isSupportedGitRepo(cwd: string): Promise<boolean> {
  try {
    const [insideWorkTree, bareRepository] = await Promise.all([
      exec("git", ["rev-parse", "--is-inside-work-tree"], cwd),
      exec("git", ["rev-parse", "--is-bare-repository"], cwd),
    ]);
    return insideWorkTree.trim() === "true" && bareRepository.trim() === "false";
  } catch {
    return false;
  }
}
