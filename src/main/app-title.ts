import path from "path";
import { getCurrentBranch, getRepoRootForProject } from "./git/repo.js";

export const APP_NAME = "Yuru";

export interface AppTitleGitContext {
  appPath: string;
  mainWorktreePath: string | null;
  branch: string | null;
}

export async function getWindowTitleForAppPath(appPath: string): Promise<string> {
  const [mainWorktreePath, branch] = await Promise.all([
    getRepoRootForProject(appPath),
    getCurrentBranch(appPath),
  ]);
  return buildWindowTitle({ appPath, mainWorktreePath, branch });
}

export function buildWindowTitle(context: AppTitleGitContext): string {
  const worktreeLabel = getLinkedWorktreeLabel(context);
  return worktreeLabel ? `${APP_NAME} - worktree: ${worktreeLabel}` : APP_NAME;
}

function getLinkedWorktreeLabel({
  appPath,
  mainWorktreePath,
  branch,
}: AppTitleGitContext): string | null {
  if (!mainWorktreePath) {
    return null;
  }

  if (path.resolve(appPath) === path.resolve(mainWorktreePath)) {
    return null;
  }

  return branch ?? path.basename(appPath);
}
