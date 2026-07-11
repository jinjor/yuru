import fs from "fs";
import path from "path";
import type { GitDiffDocument, GitDiffScope, GitLineStat, GitPathState } from "../shared/ipc.js";
import { exec, execBuffer } from "./exec.js";
import { parseNameStatusZ, parseNumstatZ, parsePorcelainLine } from "./git-status.js";
import { getUntrackedLineStats } from "./untracked-line-stats.js";

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  headSha: string;
  locked: boolean;
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

async function hasHead(cwd: string): Promise<boolean> {
  try {
    await exec("git", ["rev-parse", "--verify", "HEAD"], cwd);
    return true;
  } catch {
    return false;
  }
}

async function resolveOriginalPath(
  cwd: string,
  filePath: string,
  scope: GitDiffScope | undefined,
): Promise<string | null> {
  if (!(await hasHead(cwd))) {
    return null;
  }

  // pathspec で対象 file に絞ると rename 元が diff から外れて rename 検出が
  // 効かなくなるため、全体の name-status から対象 file の record を探す
  const rangeArgs = scope === "staged" ? ["--cached"] : ["HEAD"];
  const output = await exec(
    "git",
    ["diff", "--name-status", "--find-renames", "-z", ...rangeArgs],
    cwd,
  );

  for (const entry of parseNameStatusZ(output)) {
    if (entry.path === filePath) {
      return entry.srcPath ?? filePath;
    }
  }

  return filePath;
}

async function readGitBlob(cwd: string, filePath: string): Promise<Buffer | null> {
  try {
    return await execBuffer("git", ["show", `HEAD:${filePath}`], cwd);
  } catch {
    return null;
  }
}

async function readIndexBlob(cwd: string, filePath: string): Promise<Buffer | null> {
  try {
    return await execBuffer("git", ["show", `:0:${filePath}`], cwd);
  } catch {
    return null;
  }
}

// 不在 (null) と空ファイル ("") を区別する: 削除は null、空ファイルは ""。
// バイナリの存在する側は "" にする (バイト列を文字列で送らない)。
function bufferToContent(buffer: Buffer | null, isBinary: boolean): string | null {
  if (buffer === null) {
    return null;
  }
  return isBinary ? "" : buffer.toString("utf-8");
}

async function isPathChanged(cwd: string, filePath: string): Promise<boolean> {
  const output = await exec("git", ["status", "--porcelain", "--", filePath], cwd);
  return output.trim().length > 0;
}

async function loadOriginalBuffer(
  cwd: string,
  filePath: string,
  scope: GitDiffScope | undefined,
): Promise<Buffer | null> {
  const originalPath = await resolveOriginalPath(cwd, filePath, scope);
  return originalPath ? await readGitBlob(cwd, originalPath) : null;
}

async function readWorktreeFile(cwd: string, filePath: string): Promise<Buffer | null> {
  const currentPath = path.join(cwd, filePath);
  return fs.existsSync(currentPath) ? await fs.promises.readFile(currentPath) : null;
}

// scope なし: HEAD ↔ 作業ツリー (staged + unstaged の合算)
// staged: HEAD ↔ index / unstaged: index ↔ 作業ツリー
async function loadDiffBuffers(
  cwd: string,
  filePath: string,
  scope: GitDiffScope | undefined,
): Promise<{ originalBuffer: Buffer | null; currentBuffer: Buffer | null }> {
  if (scope === "staged") {
    const [originalBuffer, currentBuffer] = await Promise.all([
      loadOriginalBuffer(cwd, filePath, scope),
      readIndexBlob(cwd, filePath),
    ]);
    return { originalBuffer, currentBuffer };
  }

  if (scope === "unstaged") {
    const [originalBuffer, currentBuffer] = await Promise.all([
      readIndexBlob(cwd, filePath),
      readWorktreeFile(cwd, filePath),
    ]);
    return { originalBuffer, currentBuffer };
  }

  const currentBuffer = await readWorktreeFile(cwd, filePath);
  const changed = await isPathChanged(cwd, filePath);
  const originalBuffer = changed ? await loadOriginalBuffer(cwd, filePath, scope) : currentBuffer;
  return { originalBuffer, currentBuffer };
}

export async function getGitDiffDocument(
  cwd: string,
  filePath: string,
  scope?: GitDiffScope,
): Promise<GitDiffDocument> {
  const { originalBuffer, currentBuffer } = await loadDiffBuffers(cwd, filePath, scope);
  const isBinary = [originalBuffer, currentBuffer].some((buffer) => buffer?.includes(0));
  const size = Math.max(originalBuffer?.byteLength ?? 0, currentBuffer?.byteLength ?? 0);

  return {
    path: filePath,
    originalContent: bufferToContent(originalBuffer, isBinary),
    currentContent: bufferToContent(currentBuffer, isBinary),
    isBinary,
    size,
  };
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const output = await exec("git", ["worktree", "list", "--porcelain"], cwd);
  const mainWorktreePath = await getRepoRootForProject(cwd);
  return parseWorktreeListPorcelain(output, mainWorktreePath);
}

export function parseWorktreeListPorcelain(
  output: string,
  mainWorktreePath: string | null,
): WorktreeInfo[] {
  if (!output.trim()) {
    return [];
  }

  const worktrees: WorktreeInfo[] = [];
  const mainWorktreePathKey = mainWorktreePath ? toWorktreePathKey(mainWorktreePath) : null;
  const blocks = output.trim().split("\n\n");
  for (const block of blocks) {
    const lines = block.split("\n");
    let wtPath: string | null = null;
    let branch: string | null = null;
    let headSha: string | null = null;
    let locked = false;
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        wtPath = line.substring("worktree ".length);
      } else if (line.startsWith("branch ")) {
        branch = parseWorktreeBranch(line.substring("branch ".length));
      } else if (line.startsWith("HEAD ")) {
        headSha = line.substring("HEAD ".length).trim() || null;
      } else if (line === "locked" || line.startsWith("locked ")) {
        locked = true;
      }
    }
    if (wtPath && headSha && toWorktreePathKey(wtPath) !== mainWorktreePathKey) {
      worktrees.push({ path: wtPath, branch, headSha, locked });
    }
  }
  return worktrees;
}

function parseWorktreeBranch(ref: string): string {
  const headsPrefix = "refs/heads/";
  return ref.startsWith(headsPrefix) ? ref.substring(headsPrefix.length) : ref;
}

function toWorktreePathKey(worktreePath: string): string {
  return path.resolve(worktreePath);
}

export async function branchExists(cwd: string, branchName: string): Promise<boolean> {
  try {
    await exec("git", ["rev-parse", "--verify", branchName], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function renameBranch(cwd: string, oldName: string, newName: string): Promise<void> {
  await exec("git", ["branch", "-m", oldName, newName], cwd);
}

export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });
  await exec("git", ["worktree", "add", "-b", branchName, worktreePath], repoPath);
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  await exec("git", ["worktree", "remove", worktreePath], repoPath);
}

export async function unlockWorktree(repoPath: string, worktreePath: string): Promise<void> {
  await exec("git", ["worktree", "unlock", worktreePath], repoPath);
}

// 未コミット変更や untracked file があると `git worktree remove` は拒否する。`--force` でそれらを捨てて消す。
export async function removeWorktreeForce(repoPath: string, worktreePath: string): Promise<void> {
  await exec("git", ["worktree", "remove", "--force", worktreePath], repoPath);
}

// 通常削除が拒否された理由が dirty かを git 自身の status で判定する (拒否メッセージは読まない)。
export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
  const output = await exec("git", ["status", "--porcelain", "-uall"], worktreePath);
  return output.trim().length > 0;
}
