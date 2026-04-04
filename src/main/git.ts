import { execFile } from "child_process";
import fs from "fs";
import path from "path";

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export interface GitFileStatus {
  path: string;
  status: string;
}

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

export async function getGitStatus(cwd: string): Promise<GitFileStatus[]> {
  const output = await exec("git", ["status", "--porcelain", "-uall"], cwd);
  if (!output.trim()) {
    return [];
  }
  return output
    .trim()
    .split("\n")
    .map((line) => {
      const status = line.substring(0, 2).trim();
      const filePath = line.substring(3);
      return { path: filePath, status };
    });
}

export async function getGitDiff(cwd: string, filePath: string): Promise<string> {
  // Check if the file is untracked
  const statusOutput = await exec("git", ["status", "--porcelain", "--", filePath], cwd);
  const status = statusOutput.substring(0, 2).trim();

  if (status === "??") {
    // Untracked file — show full content as "added"
    const fullPath = path.join(cwd, filePath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const diffLines = lines.map((line) => `+${line}`);
      return `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n${diffLines.join("\n")}`;
    }
    return "";
  }

  // Try unstaged diff first, then staged
  let diff = await exec("git", ["diff", "--", filePath], cwd);
  if (!diff) {
    diff = await exec("git", ["diff", "--staged", "--", filePath], cwd);
  }
  return diff;
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const output = await exec("git", ["worktree", "list", "--porcelain"], cwd);
  const worktrees: WorktreeInfo[] = [];
  const blocks = output.trim().split("\n\n");
  // Skip the first block — it's always the main worktree (the repo itself)
  for (let i = 1; i < blocks.length; i++) {
    const lines = blocks[i].split("\n");
    let wtPath = "";
    let branch = "";
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        wtPath = line.substring("worktree ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.substring("branch ".length).replace("refs/heads/", "");
      }
    }
    if (wtPath && branch) {
      worktrees.push({ path: wtPath, branch });
    }
  }
  return worktrees;
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

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  await exec("git", ["worktree", "remove", worktreePath], repoPath);
}
