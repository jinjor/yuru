import fs from "fs";
import path from "path";
import type { WorktreeContext } from "./agent.js";
import { getYuruHome } from "../yuru-home.js";

const DEFAULT_WORKTREE_CONTEXT_PROMPT = [
  "Yuru opened this session for the task worktree '{worktreeName}' on branch '{branchName}'.",
  "Use {worktreePath} as the working directory for this task.",
  "When reading files, editing files, applying patches, running commands, building, or testing, operate in {worktreePath}.",
  "When mentioning a file, use a path relative to its Git worktree when the intended worktree is unambiguous from context. Use an absolute path when the worktree is ambiguous or the file is outside any worktree.",
  "The repository root {repoPath} is only the parent repository that Yuru used to launch this provider session; do not treat it as the task workspace unless the user explicitly asks you to.",
  "This message is environment context injected by Yuru, not a task instruction from the user; do not start any work until the user explicitly instructs you to.",
].join(" ");

const TEMPLATE_PATH = "worktree-context-prompt.txt";

// First sentence of the default template. Providers without launch-flag
// injection record the prompt as a regular user message, so this marker is
// used to find Yuru-injected prompts in session logs. A custom template that
// drops this sentence loses that detection path.
export const WORKTREE_CONTEXT_PROMPT_MARKER = "Yuru opened this session for the task worktree";

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
