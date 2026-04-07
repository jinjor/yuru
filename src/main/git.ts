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

export interface GitPathState {
  path: string;
  status: string;
  ignored: boolean;
}

export interface GitDiffDocument {
  path: string;
  originalContent: string;
  currentContent: string;
  isBinary: boolean;
  size: number;
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

function execBuffer(cmd: string, args: string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024, encoding: "buffer" },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function parsePorcelainLine(line: string): GitPathState | null {
  if (!line) {
    return null;
  }

  const rawStatus = line.substring(0, 2);
  const trimmedStatus = rawStatus.trim();
  let filePath = line.substring(3).trim();

  if (!filePath) {
    return null;
  }

  if (filePath.includes(" -> ")) {
    const parts = filePath.split(" -> ");
    filePath = parts[parts.length - 1] ?? filePath;
  }

  filePath = filePath.replace(/\/$/, "");

  return {
    path: filePath,
    status: trimmedStatus === "!!" ? "" : trimmedStatus,
    ignored: trimmedStatus === "!!",
  };
}

export async function getGitPathStates(cwd: string): Promise<GitPathState[]> {
  const output = await exec("git", ["status", "--porcelain", "-uall", "--ignored=matching"], cwd);
  if (!output.trim()) {
    return [];
  }

  return output
    .split("\n")
    .map(parsePorcelainLine)
    .filter((entry): entry is GitPathState => entry !== null);
}

export async function getGitStatus(cwd: string): Promise<GitFileStatus[]> {
  const entries = await getGitPathStates(cwd);
  return entries
    .filter((entry) => !entry.ignored && entry.status)
    .map((entry) => ({
      path: entry.path,
      status: entry.status,
    }));
}

async function hasHead(cwd: string): Promise<boolean> {
  try {
    await exec("git", ["rev-parse", "--verify", "HEAD"], cwd);
    return true;
  } catch {
    return false;
  }
}

async function resolveOriginalPath(cwd: string, filePath: string): Promise<string | null> {
  if (!(await hasHead(cwd))) {
    return null;
  }

  try {
    const output = await exec(
      "git",
      ["diff", "--name-status", "--find-renames", "HEAD", "--", filePath],
      cwd,
    );
    const firstLine = output.trim().split("\n")[0];
    if (firstLine?.startsWith("R")) {
      const parts = firstLine.split("\t");
      if (parts.length >= 3) {
        return parts[1];
      }
    }
  } catch {
    return filePath;
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

function bufferToContent(buffer: Buffer | null): string {
  return buffer ? buffer.toString("utf-8") : "";
}

export async function getGitDiffDocument(cwd: string, filePath: string): Promise<GitDiffDocument> {
  const currentPath = path.join(cwd, filePath);
  const currentBuffer = fs.existsSync(currentPath)
    ? await fs.promises.readFile(currentPath)
    : null;
  const originalPath = await resolveOriginalPath(cwd, filePath);
  const originalBuffer = originalPath ? await readGitBlob(cwd, originalPath) : null;
  const isBinary = [originalBuffer, currentBuffer].some((buffer) => buffer?.includes(0));
  const size = Math.max(originalBuffer?.byteLength ?? 0, currentBuffer?.byteLength ?? 0);

  return {
    path: filePath,
    originalContent: isBinary ? "" : bufferToContent(originalBuffer),
    currentContent: isBinary ? "" : bufferToContent(currentBuffer),
    isBinary,
    size,
  };
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
