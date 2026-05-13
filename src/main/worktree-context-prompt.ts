import fs from "fs";
import path from "path";
import type { WorktreeContext } from "./agent.js";
import { getYuruHome } from "./yuru-home.js";

const DEFAULT_WORKTREE_CONTEXT_PROMPT =
  "This session was opened via Yuru with the initial task worktree '{worktreeName}' (branch '{branchName}') at {worktreePath}. The repository root is {repoPath}.";

const TEMPLATE_PATH = "worktree-context-prompt.txt";

export function worktreeContextPromptPath(): string {
  return path.join(getYuruHome(), TEMPLATE_PATH);
}

export async function loadWorktreeContextPrompt(context: WorktreeContext): Promise<string> {
  const template = await readTemplate();
  return renderTemplate(template, {
    branchName: context.branchName,
    repoPath: context.repoPath,
    worktreeName: context.worktreeName,
    worktreePath: context.worktreePath,
  });
}

async function readTemplate(): Promise<string> {
  try {
    return await fs.promises.readFile(worktreeContextPromptPath(), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_WORKTREE_CONTEXT_PROMPT;
    }
    throw error;
  }
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(
    /\{(branchName|repoPath|worktreeName|worktreePath)\}/g,
    (_match, key: string) => values[key] ?? "",
  );
}
