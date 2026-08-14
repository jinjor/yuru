import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import type { SessionProvider } from "../../src/shared/session";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export interface E2eContext {
  repoRoot: string;
  tmpHome: string;
  yuruHome: string;
  addCleanupDir(dir: string): void;
  cleanup(): Promise<void>;
}

export interface TaskWorktreeMetadataSeed {
  worktreePath: string;
  primarySessions?: Array<{
    provider: SessionProvider;
    agentSessionId: string;
    cwd?: string;
  }>;
}

export interface MetadataSeed {
  repos: Array<{
    id: string;
    repoPath: string;
  }>;
  taskWorktrees: Array<{
    repoId: string;
    worktreePath: string;
    primarySessions: Array<{
      provider: SessionProvider;
      agentSessionId: string;
      cwd?: string;
    }>;
  }>;
}

interface LaunchYuruOptions {
  disableBackgroundThrottlingForE2e?: boolean;
  env?: NodeJS.ProcessEnv;
}

// Provider TUIs treat a burst of characters as a paste and swallow the Enter
// that follows it, leaving the prompt sitting unsent in the input box. Typing at
// a human-ish pace keeps it a real keystroke sequence.
export const PROMPT_TYPE_DELAY_MS = 30;

export async function createE2eContext(): Promise<E2eContext> {
  const cleanupDirs: string[] = [];
  const tmpHome = await mkdtemp(path.join(tmpdir(), "yuru-e2e-home-"));
  const yuruHome = await mkdtemp(path.join(tmpdir(), "yuru-e2e-yuru-"));
  cleanupDirs.push(tmpHome, yuruHome);

  return {
    repoRoot: process.cwd(),
    tmpHome,
    yuruHome,
    addCleanupDir(dir) {
      cleanupDirs.push(dir);
    },
    async cleanup() {
      for (const dir of cleanupDirs.reverse()) {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

export async function launchYuru(
  context: E2eContext,
  options: LaunchYuruOptions = {},
): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: [context.repoRoot],
    cwd: context.repoRoot,
    env: {
      ...process.env,
      ...options.env,
      HOME: context.tmpHome,
      YURU_E2E_HIDE_WINDOW: process.env.YURU_E2E_SHOW_WINDOW === "1" ? "0" : "1",
      YURU_HOME: context.yuruHome,
    },
  });

  // Hidden BrowserWindows are throttled by Electron by default. Keep that
  // production behavior, and disable throttling from the test harness only so
  // Playwright can drive the hidden renderer without long timer delays.
  if (options.disableBackgroundThrottlingForE2e !== false) {
    await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.setBackgroundThrottling(false);
    });
  }

  return app;
}

export async function launchWindow(
  context: E2eContext,
  options: LaunchYuruOptions = {},
): Promise<{
  app: ElectronApplication;
  window: Page;
}> {
  const app = await launchYuru(context, options);
  return {
    app,
    window: await app.firstWindow(),
  };
}

export async function closeYuru(app: ElectronApplication | null): Promise<void> {
  if (!app) {
    return;
  }
  const proc = app.process();
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return;
  }

  await app.evaluate(({ app }) => {
    app.quit();
  });
  await new Promise<void>((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }
    proc.once("exit", () => resolve());
  });
}

export async function createCommittedRepo(
  context: E2eContext,
  files: Record<string, string> = { "README.md": "# e2e\n" },
): Promise<string> {
  const repoDir = await createEmptyRepo(context);
  await writeFiles(repoDir, files);
  git(["add", "."], repoDir);
  git(["commit", "-m", "init"], repoDir);
  return repoDir;
}

export async function createEmptyRepo(context: E2eContext): Promise<string> {
  const repoDir = realpathSync(await mkdtemp(path.join(tmpdir(), "yuru-e2e-repo-")));
  context.addCleanupDir(repoDir);
  git(["init", "-b", "main"], repoDir);
  git(["config", "user.email", "e2e@example.com"], repoDir);
  git(["config", "user.name", "E2E"], repoDir);
  return repoDir;
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }),
  );
}

export function git(args: string[], cwd: string): void {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  execFileSync("git", args, { cwd, env, stdio: "ignore" });
}

export function gitOutput(args: string[], cwd: string): string {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return execFileSync("git", args, { cwd, env, encoding: "utf8" });
}

export async function createGitWorktree(
  context: E2eContext,
  repoDir: string,
  branchName: string,
  options: { detached?: boolean; worktreeName?: string } = {},
): Promise<string> {
  const parentDir = realpathSync(await mkdtemp(path.join(tmpdir(), "yuru-e2e-worktrees-")));
  context.addCleanupDir(parentDir);
  const worktreePath = path.join(parentDir, options.worktreeName ?? branchName.replace(/\//g, "-"));
  if (options.detached) {
    git(["worktree", "add", "--detach", worktreePath, "HEAD"], repoDir);
  } else {
    git(["worktree", "add", "-b", branchName, worktreePath], repoDir);
  }
  return worktreePath;
}

export async function registerRepo(
  context: E2eContext,
  repoPath: string,
  taskWorktrees: TaskWorktreeMetadataSeed[] = [],
): Promise<string> {
  const repoId = randomUUID();
  await writeMetadata(context, {
    repos: [{ id: repoId, repoPath }],
    taskWorktrees: taskWorktrees.map((entry) => ({
      repoId,
      worktreePath: entry.worktreePath,
      primarySessions: entry.primarySessions ?? [],
    })),
  });
  return repoId;
}

export async function writeMetadata(context: E2eContext, metadata: MetadataSeed): Promise<void> {
  await writeFile(metadataPath(context), `${JSON.stringify(metadata, null, 2)}\n`);
}

export async function readMetadata(context: E2eContext): Promise<MetadataSeed> {
  return JSON.parse(await readFile(metadataPath(context), "utf8")) as MetadataSeed;
}

export async function seedClaudeHome(home: string, trustedRepoPath: string): Promise<void> {
  const credentials = execFileSync(
    "security",
    ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
    { encoding: "utf8" },
  );
  const claudeDir = path.join(home, ".claude");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(path.join(claudeDir, ".credentials.json"), credentials, { mode: 0o600 });
  await writeFile(
    path.join(home, ".claude.json"),
    JSON.stringify({
      hasCompletedOnboarding: true,
      projects: {
        [trustedRepoPath]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true },
      },
    }),
  );
}

export async function seedCodexHome(home: string, trustedRepoPath: string): Promise<void> {
  const codexDir = path.join(home, ".codex");
  await mkdir(codexDir, { recursive: true });
  await copyFile(path.join(homedir(), ".codex", "auth.json"), path.join(codexDir, "auth.json"));
  await writeFile(
    path.join(codexDir, "config.toml"),
    [
      `model = "gpt-5.5"`,
      "",
      "[notice]",
      "hide_rate_limit_model_nudge = true",
      "",
      `[projects.${JSON.stringify(trustedRepoPath)}]`,
      `trust_level = "trusted"`,
      "",
    ].join("\n"),
  );
  await seedCodexVersionCheck(codexDir);
}

// Codex shows a blocking "Update available" prompt in the TUI when a newer
// version is known and not yet dismissed. In a fresh isolated home the first run
// caches that result and the next run prompts, which freezes the resumed
// transcript. Pre-seed the cache with the update already dismissed and just
// checked so codex never prompts during a test.
async function seedCodexVersionCheck(codexDir: string): Promise<void> {
  const real = JSON.parse(readFileSync(path.join(homedir(), ".codex", "version.json"), "utf8")) as {
    latest_version: string;
  };
  await writeFile(
    path.join(codexDir, "version.json"),
    JSON.stringify({
      latest_version: real.latest_version,
      last_checked_at: new Date().toISOString(),
      dismissed_version: real.latest_version,
    }),
  );
}

export async function trustCodexProject(home: string, projectPath: string): Promise<void> {
  await appendFile(
    path.join(home, ".codex", "config.toml"),
    `[projects.${JSON.stringify(projectPath)}]\ntrust_level = "trusted"\n`,
  );
}

export async function trustClaudeProject(home: string, projectPath: string): Promise<void> {
  const dotClaudePath = path.join(home, ".claude.json");
  const dotClaude = JSON.parse(await readFile(dotClaudePath, "utf8")) as {
    projects: Record<string, unknown>;
  };
  dotClaude.projects[projectPath] = {
    hasTrustDialogAccepted: true,
    hasCompletedProjectOnboarding: true,
  };
  await writeFile(dotClaudePath, JSON.stringify(dotClaude));
}

// Simulates work done outside Yuru: runs the real Claude CLI headlessly inside
// `cwd` so it persists a genuine, resumable session there, then adds the history
// entry an interactive session would have written (headless `claude -p` does not
// write one) so Yuru's history-based resume lookup can find it. Returns the id.
export function createExternalClaudeSession(home: string, cwd: string, prompt: string): string {
  execFileSync("claude", ["-p", prompt], {
    cwd,
    env: { ...process.env, HOME: home },
    stdio: "ignore",
    timeout: 90_000,
  });
  const projectDir = path.join(home, ".claude", "projects", cwd.replace(/[/.]/g, "-"));
  const sessionFile = readdirSync(projectDir).find((entry) => entry.endsWith(".jsonl"));
  if (!sessionFile) {
    throw new Error(`No Claude session file was created under ${projectDir}`);
  }
  const sessionId = sessionFile.replace(/\.jsonl$/, "");
  appendFileSync(
    path.join(home, ".claude", "history.jsonl"),
    `${JSON.stringify({ sessionId, project: cwd, display: "", timestamp: Date.now() })}\n`,
  );
  return sessionId;
}

// Codex counterpart of createExternalClaudeSession: runs the real Codex CLI
// non-interactively inside `cwd` so it persists a genuine, resumable rollout
// recorded under that directory. Codex's session_meta carries the cwd, so Yuru
// discovers it as a suggested session without needing a separate history entry.
export function createExternalCodexSession(home: string, cwd: string, prompt: string): void {
  execFileSync("codex", ["exec", prompt], {
    cwd,
    env: { ...process.env, HOME: home },
    stdio: "ignore",
    timeout: 120_000,
  });
}

export async function seedClaudeStoredSession(
  home: string,
  options: {
    project: string;
    sessionId?: string;
    preview?: string;
    cwdEvidence?: string;
    timestamp?: number;
  },
): Promise<string> {
  const sessionId = options.sessionId ?? randomUUID();
  const timestamp = options.timestamp ?? Date.now();
  const sessionFilePath = claudeSessionFilePath(home, options.project, sessionId);
  await mkdir(path.dirname(sessionFilePath), { recursive: true });
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await writeFile(
    path.join(home, ".claude", "history.jsonl"),
    `${JSON.stringify({ sessionId, project: options.project, display: "", timestamp })}\n`,
    { flag: "a" },
  );

  const lines: string[] = [];
  if (options.cwdEvidence) {
    lines.push(JSON.stringify({ sessionId, cwd: options.cwdEvidence }));
  }
  if (options.preview) {
    lines.push(
      JSON.stringify({
        type: "assistant",
        timestamp: new Date(timestamp).toISOString(),
        message: { role: "assistant", content: options.preview },
      }),
    );
  }
  await writeFile(sessionFilePath, `${lines.join("\n")}\n`);
  return sessionId;
}

export async function openMainTerminal(window: Page): Promise<void> {
  await worktreeCard(window, "terminal").click();
  await expect(visibleWorktreeView(window).locator(".xterm")).toBeVisible({ timeout: 10_000 });
}

// ヘッダはファイル名とディレクトリを分けて出すので、両者をまとめて検証する。
export async function expectPreviewPath(window: Page, fullPath: string): Promise<void> {
  const sessionView = visibleWorktreeView(window);
  const lastSlash = fullPath.lastIndexOf("/");
  const name = lastSlash < 0 ? fullPath : fullPath.slice(lastSlash + 1);
  await expect(sessionView.locator(".preview-filename")).toHaveText(name);
  if (lastSlash >= 0) {
    await expect(sessionView.locator(".preview-dir")).toHaveText(fullPath.slice(0, lastSlash));
  }
}

// Activity で hidden な WorktreeView の DOM も残るため、右ペインを触る E2E は
// 表示中の各トップレベル要素に scope して strict mode の複数 match を避ける。
export function visibleWorktreeView(window: Page): Locator {
  return window
    .locator(".app > .worktree-view-column, .app > .changes-panel, .app > .file-search")
    .filter({ visible: true });
}

export function worktreeCard(window: Page, text: string) {
  return window.locator(".task-worktree-card", { hasText: text });
}

export function claudeConversationCount(home: string, project: string): number {
  const dir = path.join(home, ".claude", "projects", project.replace(/[/.]/g, "-"));
  if (!existsSync(dir)) {
    return 0;
  }
  return readdirSync(dir).filter((entry) => entry.endsWith(".jsonl")).length;
}

// A completed, authenticated turn lands an assistant message in the session
// store. The CLIs write a session_meta row at boot before any turn, so merely
// counting session files does not prove a turn happened; checking for an
// assistant message does. The shapes below match the app's own session parsers.
export function claudeHasAssistantReply(home: string, project: string): boolean {
  const dir = path.join(home, ".claude", "projects", project.replace(/[/.]/g, "-"));
  if (!existsSync(dir)) {
    return false;
  }
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".jsonl"))
    .some((entry) =>
      jsonLines(path.join(dir, entry)).some((row) => {
        const line = row as { type?: unknown; message?: { role?: unknown } };
        return line.type === "assistant" && line.message?.role === "assistant";
      }),
    );
}

export function codexHasAssistantReply(home: string): boolean {
  const sessionsDir = path.join(home, ".codex", "sessions");
  if (!existsSync(sessionsDir)) {
    return false;
  }
  return readdirSync(sessionsDir, { recursive: true })
    .filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".jsonl"))
    .some((entry) =>
      jsonLines(path.join(sessionsDir, entry)).some((row) => {
        const line = row as { type?: unknown; payload?: { type?: unknown; role?: unknown } };
        return (
          line.type === "response_item" &&
          line.payload?.type === "message" &&
          line.payload.role === "assistant"
        );
      }),
    );
}

function jsonLines(filePath: string): unknown[] {
  const rows: unknown[] = [];
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    if (!line) {
      continue;
    }
    try {
      rows.push(JSON.parse(line));
    } catch {
      // Skip partial rows still being written by the CLI.
    }
  }
  return rows;
}

export function codexConversationCount(home: string): number {
  const sessionsDir = path.join(home, ".codex", "sessions");
  if (!existsSync(sessionsDir)) {
    return 0;
  }
  return readdirSync(sessionsDir, { recursive: true }).filter(
    (entry) => typeof entry === "string" && entry.endsWith(".jsonl"),
  ).length;
}

function metadataPath(context: E2eContext): string {
  return path.join(context.yuruHome, "metadata.json");
}

function claudeSessionFilePath(home: string, project: string, sessionId: string): string {
  return path.join(
    home,
    ".claude",
    "projects",
    project.replace(/[/.]/g, "-"),
    `${sessionId}.jsonl`,
  );
}
