import fs from "fs";
import path from "path";
import type {
  GitDiffDocument,
  GitDiffScope,
  GitLineStat,
  GitPathState,
  GitReviewLayer,
  GitReviewSnapshot,
} from "../shared/ipc.js";
import { exec, execBuffer } from "./exec.js";
import { parseNameStatusZ, parseNumstatZ, parsePorcelainLine } from "./git-status.js";
import { baseOidForLayer, blobOid, loadRawDiff, rawEntryMap } from "./review-fingerprint.js";
import { getUntrackedLineStats } from "./untracked-line-stats.js";

interface WorktreeListPorcelainEntry {
  path: string;
  branch: string | null;
  headSha: string;
  locked: boolean;
}

export interface WorktreeInfo extends WorktreeListPorcelainEntry {
  createdAt: number;
}

export interface GitReviewBase {
  branch: string;
  mergeBase: string;
}

const reviewBaseCache = new Map<string, { key: string; value: GitReviewBase | null }>();

async function getDefaultBranch(cwd: string): Promise<string | null> {
  try {
    const output = await exec(
      "git",
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      cwd,
    );
    const ref = output.trim();
    return ref.startsWith("origin/") ? ref.slice("origin/".length) : null;
  } catch (error) {
    if (isExitCode(error, 1)) {
      return null;
    }
    throw error;
  }
}

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

// origin/HEAD は default branch の名前の特定だけに使い、Review の基準は対応する
// local branch に固定する。stacked branch でも parent を推測せず、default branch
// からの全差分として表示する。HEAD と base が同じ間は merge-base を再実行しない。
export async function resolveGitReviewBase(cwd: string): Promise<GitReviewBase | null> {
  const [head, branch] = await Promise.all([getHeadSha(cwd), getDefaultBranch(cwd)]);
  if (!head || !branch) {
    return null;
  }
  const base = await getReviewBaseSha(cwd, branch);
  if (!base) {
    return null;
  }

  const key = JSON.stringify({ head, branch, base });
  const cacheKey = path.resolve(cwd);
  const cached = reviewBaseCache.get(cacheKey);
  if (cached?.key === key) {
    return cached.value;
  }

  let mergeBase: string;
  try {
    mergeBase = (await exec("git", ["merge-base", base, head], cwd)).trim();
  } catch (error) {
    if (!isExitCode(error, 1)) {
      throw error;
    }
    reviewBaseCache.set(cacheKey, { key, value: null });
    return null;
  }

  const value = mergeBase ? { branch, mergeBase } : null;
  reviewBaseCache.set(cacheKey, { key, value });
  return value;
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
  reviewBase?: GitReviewBase,
): Promise<string | null> {
  if (!(await hasHead(cwd))) {
    return null;
  }

  // pathspec で対象 file に絞ると rename 元が diff から外れて rename 検出が
  // 効かなくなるため、全体の name-status から対象 file の record を探す
  let rangeArgs: string[];
  if (scope === "base") {
    const base = reviewBase ?? (await resolveGitReviewBase(cwd));
    if (!base) {
      throw new Error("Base branch is unknown.");
    }
    rangeArgs = [base.mergeBase, "HEAD"];
  } else {
    rangeArgs = scope === "staged" ? ["--cached"] : ["HEAD"];
  }
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

async function readGitBlobAt(cwd: string, ref: string, filePath: string): Promise<Buffer | null> {
  try {
    return await execBuffer("git", ["show", `${ref}:${filePath}`], cwd);
  } catch {
    return null;
  }
}

async function readGitBlob(cwd: string, filePath: string): Promise<Buffer | null> {
  return readGitBlobAt(cwd, "HEAD", filePath);
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
  reviewBase?: GitReviewBase,
): Promise<Buffer | null> {
  const originalPath = await resolveOriginalPath(cwd, filePath, scope, reviewBase);
  if (!originalPath) {
    return null;
  }
  if (scope === "base") {
    const base = reviewBase ?? (await resolveGitReviewBase(cwd));
    if (!base) {
      throw new Error("Base branch is unknown.");
    }
    return readGitBlobAt(cwd, base.mergeBase, originalPath);
  }
  return readGitBlob(cwd, originalPath);
}

async function readWorktreeFile(cwd: string, filePath: string): Promise<Buffer | null> {
  const currentPath = path.join(cwd, filePath);
  return fs.existsSync(currentPath) ? await fs.promises.readFile(currentPath) : null;
}

// scope なし: HEAD ↔ 作業ツリー (staged + unstaged の合算)
// base: merge-base ↔ HEAD / staged: HEAD ↔ index / unstaged: index ↔ 作業ツリー
async function loadDiffBuffers(
  cwd: string,
  filePath: string,
  scope: GitDiffScope | undefined,
  reviewBase?: GitReviewBase | null,
): Promise<{ originalBuffer: Buffer | null; currentBuffer: Buffer | null }> {
  if (scope === "base") {
    const base = reviewBase === undefined ? await resolveGitReviewBase(cwd) : reviewBase;
    if (!base) {
      throw new Error("Base branch is unknown.");
    }
    const [originalBuffer, currentBuffer] = await Promise.all([
      loadOriginalBuffer(cwd, filePath, scope, base),
      readGitBlob(cwd, filePath),
    ]);
    return { originalBuffer, currentBuffer };
  }

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

function layerForScope(scope: GitDiffScope | undefined): GitReviewLayer {
  return scope === "base" ? "head" : scope === "staged" ? "index" : "worktree";
}

async function createReviewSnapshot(
  cwd: string,
  filePath: string,
  scope: GitDiffScope | undefined,
  reviewBase: GitReviewBase,
  originalBuffer: Buffer | null,
  currentBuffer: Buffer | null,
): Promise<GitReviewSnapshot> {
  const layer = layerForScope(scope);
  const approvedOid = blobOid(currentBuffer);
  const diffByPath = rawEntryMap(await loadRawDiff(cwd, reviewBase.mergeBase, layer));
  return {
    path: filePath,
    layer,
    originalOid: blobOid(originalBuffer),
    baseOid: baseOidForLayer(
      filePath,
      approvedOid,
      diffByPath,
      layer === "worktree" && originalBuffer === null && currentBuffer !== null,
    ),
    approvedOid,
  };
}

async function loadGitDiffDocument(
  cwd: string,
  filePath: string,
  scope: GitDiffScope | undefined,
  reviewBase: GitReviewBase | null | undefined,
): Promise<GitDiffDocument> {
  const { originalBuffer, currentBuffer } = await loadDiffBuffers(cwd, filePath, scope, reviewBase);
  const isBinary = [originalBuffer, currentBuffer].some((buffer) => buffer?.includes(0));
  const size = Math.max(originalBuffer?.byteLength ?? 0, currentBuffer?.byteLength ?? 0);
  // scope なしは Files / Search から開く HEAD ↔ worktree の合算 diff。
  // 変更がある時だけ base を遅延解決し、通常のファイル閲覧には review 用 Git 処理を増やさない。
  const hasReviewableChange = scope !== undefined || originalBuffer !== currentBuffer;
  const resolvedReviewBase = hasReviewableChange
    ? reviewBase === undefined
      ? await resolveGitReviewBase(cwd)
      : reviewBase
    : null;
  const reviewSnapshot = resolvedReviewBase
    ? await createReviewSnapshot(
        cwd,
        filePath,
        scope,
        resolvedReviewBase,
        originalBuffer,
        currentBuffer,
      )
    : undefined;

  return {
    path: filePath,
    originalContent: bufferToContent(originalBuffer, isBinary),
    currentContent: bufferToContent(currentBuffer, isBinary),
    isBinary,
    size,
    reviewSnapshot,
  };
}

export async function getGitDiffDocument(
  cwd: string,
  filePath: string,
  scope?: GitDiffScope,
): Promise<GitDiffDocument> {
  const reviewBase = scope ? await resolveGitReviewBase(cwd) : undefined;
  return loadGitDiffDocument(cwd, filePath, scope, reviewBase);
}

export async function getCurrentGitReviewSnapshot(
  cwd: string,
  filePath: string,
  scope: GitDiffScope | undefined,
): Promise<GitReviewSnapshot | null> {
  const reviewBase = await resolveGitReviewBase(cwd);
  if (!reviewBase) {
    return null;
  }
  const document = await loadGitDiffDocument(cwd, filePath, scope, reviewBase);
  return document.reviewSnapshot ?? null;
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const [output, commonGitDirOutput] = await Promise.all([
    exec("git", ["worktree", "list", "--porcelain"], cwd),
    exec("git", ["rev-parse", "--git-common-dir"], cwd),
  ]);
  const commonGitDir = await fs.promises.realpath(path.resolve(cwd, commonGitDirOutput.trim()));
  const worktrees = parseWorktreeListPorcelain(output, path.dirname(commonGitDir));
  if (worktrees.length === 0) {
    return [];
  }

  const createdAtByPath = await loadWorktreeCreatedAtByPath(commonGitDir);
  return worktrees
    .map((worktree) => {
      const createdAt = createdAtByPath.get(toWorktreePathKey(worktree.path));
      if (createdAt === undefined) {
        throw new Error(`Git worktree metadata is missing for "${worktree.path}".`);
      }
      return { ...worktree, createdAt };
    })
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function parseWorktreeListPorcelain(
  output: string,
  mainWorktreePath: string | null,
): WorktreeListPorcelainEntry[] {
  if (!output.trim()) {
    return [];
  }

  const worktrees: WorktreeListPorcelainEntry[] = [];
  const mainWorktreePathKey = mainWorktreePath ? toWorktreePathKey(mainWorktreePath) : null;
  const blocks = output.trim().split("\n\n");
  for (const block of blocks) {
    const lines = block.split("\n");
    let wtPath: string | null = null;
    let branch: string | null = null;
    let headSha: string | null = null;
    let locked = false;
    let prunable = false;
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        wtPath = line.substring("worktree ".length);
      } else if (line.startsWith("branch ")) {
        branch = parseWorktreeBranch(line.substring("branch ".length));
      } else if (line.startsWith("HEAD ")) {
        headSha = line.substring("HEAD ".length).trim() || null;
      } else if (line === "locked" || line.startsWith("locked ")) {
        locked = true;
      } else if (line === "prunable" || line.startsWith("prunable ")) {
        prunable = true;
      }
    }
    // prunable はディレクトリが消えるなどして git が「もう存在しない」と
    // 判定した worktree。git 操作の cwd に使えないため一覧から除外する
    if (wtPath && headSha && !prunable && toWorktreePathKey(wtPath) !== mainWorktreePathKey) {
      worktrees.push({ path: wtPath, branch, headSha, locked });
    }
  }
  return worktrees;
}

async function loadWorktreeCreatedAtByPath(commonGitDir: string): Promise<Map<string, number>> {
  const worktreesDir = path.join(commonGitDir, "worktrees");
  const adminEntries = (await fs.promises.readdir(worktreesDir, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory(),
  );
  const worktreeCreatedAtEntries = await Promise.all(
    adminEntries.map(async (entry) => {
      const adminDir = path.join(worktreesDir, entry.name);
      const [gitDir, stats] = await Promise.all([
        fs.promises.readFile(path.join(adminDir, "gitdir"), "utf8"),
        fs.promises.stat(adminDir),
      ]);
      const worktreePath = path.dirname(path.resolve(adminDir, gitDir.trim()));
      return [toWorktreePathKey(worktreePath), stats.birthtimeMs] as const;
    }),
  );
  return new Map(worktreeCreatedAtEntries);
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
    // 裸の名前だと同名の tag などにもマッチするため、local branch の ref だけを確認する
    await exec("git", ["rev-parse", "--verify", `refs/heads/${branchName}`], cwd);
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

// origin から branch を取り込む。取り込みと存在確認を兼ね、標準の fetch refspec なら
// remote-tracking ref (origin/<branch>) もこの fetch で更新される。`refs/heads/` を
// 付けて渡すのは、branch 名がオプションとして解釈される余地をなくすため。
export async function fetchOriginBranch(repoPath: string, branchName: string): Promise<void> {
  await exec("git", ["fetch", "origin", `refs/heads/${branchName}`], repoPath);
}

// origin/<branch> を起点に、同名の local branch を upstream 付きで作って worktree を掘る。
export async function createWorktreeFromOriginBranch(
  repoPath: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });
  await exec(
    "git",
    ["worktree", "add", "--track", "-b", branchName, worktreePath, `origin/${branchName}`],
    repoPath,
  );
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
