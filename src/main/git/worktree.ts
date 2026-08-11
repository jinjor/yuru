import fs from "fs";
import path from "path";
import { exec } from "../exec.js";
import { toWorktreePathKey } from "../worktree-identity.js";

interface WorktreeListPorcelainEntry {
  path: string;
  branch: string | null;
  headSha: string;
  locked: boolean;
}

export interface WorktreeInfo extends WorktreeListPorcelainEntry {
  createdAt: number;
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
