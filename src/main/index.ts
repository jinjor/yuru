import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import path from "path";
import * as pty from "node-pty";
import {
  attachPrimarySessionByPath,
  detachPrimarySessionByPath,
  findRepoByPath,
  loadRepoList,
  loadRepos,
  loadTaskWorktrees,
  removeTaskWorktreeByPath,
  toWorktreeId,
  upsertTaskWorktree,
} from "./metadata.js";
import {
  loadSessions,
  loadStoredSessionPreviews,
  loadSuggestedWorktreeSessions,
} from "./sessions.js";
import {
  getGitPathStates,
  getGitDiffDocument,
  getCurrentBranch,
  getRepoRootForProject,
  listWorktrees,
  removeWorktree,
  branchExists,
} from "./git.js";
import { getGitHubPullRequestForBranch } from "./github.js";
import { listAllFiles, listFiles, resolveRepoFile } from "./files.js";
import {
  getSessionProvider,
  listSessionProviderDefinitions,
} from "./agent-registry.js";
import {
  type LaunchRequest,
  type PendingSession,
  type RuntimeSessionInfo,
  type SessionProviderAdapter,
  type WorktreeContext,
} from "./agent.js";
import { WorktreeWatcher } from "./worktree-watcher.js";
import { FileTreeWatcher } from "./file-tree-watcher.js";
import fs from "fs";
import {
  type AppError,
  type AppErrorNotice,
  type BranchContext,
  type Result,
  type WorktreeSessionSelection,
} from "../shared/ipc.js";
import {
  type SessionProvider,
  type SuggestedWorktreeSession,
  toRuntimeSessionKey,
  toSessionKey,
} from "../shared/session.js";
import { toAppError } from "./errors.js";
import {
  clearErrorNotices,
  dismissErrorNotice,
  listErrorNotices,
  recordAppError,
} from "./error-center.js";
import { createTerminalEnv } from "./terminal-env.js";
import { createShellLaunchCommand } from "./shell-launch.js";

let mainWindow: BrowserWindow | null = null;
const ptyProcesses = new Map<string, pty.IPty>();
const ptyScrollback = new Map<string, string>();
const ptyAttachments = new Map<string, { ready: boolean; pendingChunks: string[] }>();
const pendingProcesses = new Set<pty.IPty>();
const sessionRuntimeMap = new Map<string, RuntimeSessionInfo>();
let worktreeWatcher: WorktreeWatcher | null = null;
const fileTreeWatcher = new FileTreeWatcher((runtimeSessionId, relativePath) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("files:changed", runtimeSessionId, relativePath);
});
const APP_NAME = "Yuru";
const STARTUP_OUTPUT_LIMIT = 4000;
const TERMINAL_SCROLLBACK_LIMIT = 200000;
const ESCAPE_CHARACTER = String.fromCharCode(0x1b);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-9;]*[A-Za-z]`, "g");

app.setName(APP_NAME);

interface StartedSession {
  runtimeSessionId: string;
  providerSessionId: string | null;
}

interface WorktreeSessionResumeTarget {
  provider: SessionProvider;
  providerSessionId: string;
  repoPath: string;
  project: string;
}

function ok<T>(data: T): Result<T> {
  return {
    ok: true,
    data,
  };
}

function fail<T>(error: AppError): Result<T> {
  return {
    ok: false,
    error,
  };
}

function emitErrorAdded(notice: AppErrorNotice): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("errors:added", notice);
}

function emitErrorRemoved(id: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("errors:removed", id);
}

function emitErrorsCleared(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("errors:cleared");
}

function logAppError(error: AppError): void {
  if (error.detail) {
    console.error(`[Yuru] ${error.message}`, error.detail);
    return;
  }
  console.error(`[Yuru] ${error.message}`);
}

function reportError(error: AppError): AppError {
  logAppError(error);
  emitErrorAdded(recordAppError(error));
  return error;
}

function failAndReport<T>(error: AppError): Result<T> {
  return fail(reportError(error));
}

function isAppError(error: unknown): error is AppError {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const maybeError = error as { code?: unknown; message?: unknown };
  return typeof maybeError.code === "string" && typeof maybeError.message === "string";
}

function getActiveRuntimeSessionIdsByKey(): Map<string, string> {
  const idsByKey = new Map<string, string>();
  for (const [runtimeSessionId, info] of sessionRuntimeMap) {
    if (info.providerSessionId) {
      idsByKey.set(toSessionKey(info.provider, info.providerSessionId), runtimeSessionId);
    }
  }
  return idsByKey;
}

function getActiveRuntimeSessionsByWorktreePath(): Map<
  string,
  { provider: SessionProvider; runtimeSessionId: string }
> {
  const sessionsByWorktreePath = new Map<
    string,
    { provider: SessionProvider; runtimeSessionId: string }
  >();
  for (const [runtimeSessionId, info] of sessionRuntimeMap) {
    sessionsByWorktreePath.set(path.resolve(info.worktreePath), {
      provider: info.provider,
      runtimeSessionId,
    });
  }
  return sessionsByWorktreePath;
}

function hasActivePrimarySessionForWorktree(worktreePath: string): boolean {
  const worktreePathKey = path.resolve(worktreePath);
  const taskWorktree = loadTaskWorktrees().find(
    (entry) => path.resolve(entry.worktreePath) === worktreePathKey,
  );
  const primarySession = taskWorktree?.primarySession;
  if (!primarySession) {
    return false;
  }
  return getActiveRuntimeSessionIdsByKey().has(
    toSessionKey(primarySession.provider, primarySession.providerSessionId),
  );
}

function appendStartupOutput(existing: string, chunk: string): string {
  const combined = `${existing}${chunk}`;
  if (combined.length <= STARTUP_OUTPUT_LIMIT) {
    return combined;
  }
  return combined.slice(-STARTUP_OUTPUT_LIMIT);
}

function appendTerminalOutput(existing: string, chunk: string): string {
  const combined = `${existing}${chunk}`;
  if (combined.length <= TERMINAL_SCROLLBACK_LIMIT) {
    return combined;
  }
  return combined.slice(-TERMINAL_SCROLLBACK_LIMIT);
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, "");
}

function summarizeStartupOutput(output: string): string | undefined {
  const cleaned = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (cleaned.length === 0) {
    return undefined;
  }
  return cleaned.slice(-3).join(" ");
}

function startupFailureMessage(pending: PendingSession, exitCode: number, signal?: number): AppError {
  const detail = startupExitDetail(pending.startupOutput, exitCode, signal);

  if (exitCode === 127) {
    return {
      code: "command_not_found",
      message: `${pending.launchLabel}. Yuru could not find a command needed to launch ${pending.command}.`,
      detail,
    };
  }

  if (exitCode === 126) {
    return {
      code: "command_failed",
      message: `${pending.launchLabel}. Yuru found ${pending.command}, but could not execute it.`,
      detail,
    };
  }

  return {
    code: "command_failed",
    message: `${pending.launchLabel}. ${pending.command} exited before startup finished.`,
    detail,
  };
}

function startupExitDetail(output: string, exitCode: number, signal?: number): string | undefined {
  const summary = summarizeStartupOutput(output);
  if (summary) {
    return summary;
  }
  if (signal && signal > 0) {
    return `Process exited with signal ${signal}.`;
  }
  if (exitCode !== undefined && exitCode !== 0) {
    return `Process exited with code ${exitCode}.`;
  }
  return "Process exited immediately.";
}

function installApplicationMenu(): void {
  const isMac = process.platform === "darwin";
  const isDev = !app.isPackaged;
  const macAppExtras: MenuItemConstructorOptions[] = isMac
    ? [{ role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }]
    : [];
  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: "about", label: `About ${APP_NAME}` },
        { type: "separator" },
        { label: "Settings...", enabled: false },
        { type: "separator" },
        ...macAppExtras,
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    ...(isDev
      ? [
          {
            label: "View",
            submenu: [{ role: "toggleDevTools" }],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

function launchPendingSession(
  providerAdapter: SessionProviderAdapter,
  request: LaunchRequest,
  launchLabel: string,
): PendingSession {
  const existingProviderSessionIds = request.existingProviderSessionIds ?? new Set<string>();
  const launchCommand = createShellLaunchCommand(providerAdapter.command, request.args, process.env);
  const proc = pty.spawn(launchCommand.command, launchCommand.args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: request.cwd,
    env: createTerminalEnv(process.env, providerAdapter.definition.id),
  });
  pendingProcesses.add(proc);
  const pending: PendingSession = {
    proc,
    provider: providerAdapter.definition.id,
    command: providerAdapter.command,
    launchCwd: request.cwd,
    launchLabel,
    outputBuffer: "",
    startupOutput: "",
    worktreePath: request.worktreePath,
    providerSessionId: null,
    runtimeSessionId: null,
    startedAt: Date.now(),
    existingProviderSessionIds,
    exited: false,
    startupSettled: false,
    startupFailureReported: false,
  };

  setTimeout(() => {
    pending.startupSettled = true;
  }, 1500);

  proc.onData((data: string) => {
    pending.outputBuffer = appendTerminalOutput(pending.outputBuffer, data);
    if (!pending.startupSettled) {
      pending.startupOutput = appendStartupOutput(pending.startupOutput, data);
    }
    if (!pending.runtimeSessionId || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    ptyScrollback.set(
      pending.runtimeSessionId,
      appendTerminalOutput(ptyScrollback.get(pending.runtimeSessionId) ?? "", data),
    );
    const attachment = ptyAttachments.get(pending.runtimeSessionId);
    if (!attachment) {
      return;
    }
    if (!attachment.ready) {
      attachment.pendingChunks.push(data);
      return;
    }
    mainWindow.webContents.send("pty:data", pending.runtimeSessionId, data);
  });

  proc.onExit(({ exitCode, signal }) => {
    pending.exited = true;
    pending.exitCode = exitCode;
    pending.signal = signal;
    console.info("[Yuru] session process exited", {
      runtimeSessionId: pending.runtimeSessionId,
      provider: pending.provider,
      providerSessionId: pending.providerSessionId,
      launchCwd: pending.launchCwd,
      worktreePath: pending.worktreePath,
      exitCode,
      signal,
      startupSettled: pending.startupSettled,
    });
    pendingProcesses.delete(proc);
    if (!pending.startupSettled && !pending.startupFailureReported) {
      pending.startupFailureReported = true;
      reportError(startupFailureMessage(pending, exitCode, signal));
    }
    if (!pending.runtimeSessionId) {
      return;
    }
    ptyProcesses.delete(pending.runtimeSessionId);
    ptyAttachments.delete(pending.runtimeSessionId);
    fileTreeWatcher.clearSession(pending.runtimeSessionId);
    sessionRuntimeMap.delete(pending.runtimeSessionId);
    void refreshWorktreeWatcher();
    emitSessionsStateChanged();
  });

  return pending;
}

async function waitForResumeReady(
  providerAdapter: SessionProviderAdapter,
  pending: PendingSession,
  expectedProviderSessionId: string,
): Promise<void> {
  if (providerAdapter.resolvesSessionIdLazily) {
    return;
  }

  try {
    const providerSessionId = await providerAdapter.waitForSessionId(pending);
    pending.startupSettled = true;
    if (providerSessionId !== expectedProviderSessionId) {
      throw {
        code: "command_failed",
        message: `${pending.launchLabel}. ${pending.command} resumed a different session.`,
        detail: `Expected ${expectedProviderSessionId}, got ${providerSessionId}.`,
      } satisfies AppError;
    }
  } catch (error) {
    if (pending.exited) {
      throw startupFailureMessage(pending, pending.exitCode ?? 1, pending.signal);
    }
    throw error;
  }
}

function registerRuntimeSession(
  runtimeSessionId: string,
  pending: PendingSession,
  providerSessionId: string | null,
): void {
  pending.providerSessionId = providerSessionId;
  pending.runtimeSessionId = runtimeSessionId;
  pendingProcesses.delete(pending.proc);
  ptyProcesses.set(runtimeSessionId, pending.proc);
  ptyScrollback.set(runtimeSessionId, pending.outputBuffer);
  sessionRuntimeMap.set(runtimeSessionId, {
    provider: pending.provider,
    providerSessionId,
    worktreePath: pending.worktreePath,
    startedAt: pending.startedAt,
  });
}

function createRuntimeSessionId(provider: SessionProvider, pending: PendingSession): string {
  return toRuntimeSessionKey(provider, pending.startedAt);
}

function updateRuntimeSessionProviderSessionId(runtimeSessionId: string, providerSessionId: string): void {
  const runtime = sessionRuntimeMap.get(runtimeSessionId);
  if (runtime) {
    sessionRuntimeMap.set(runtimeSessionId, {
      ...runtime,
      providerSessionId,
    });
  }
}

async function resolveLazySessionId(
  providerAdapter: SessionProviderAdapter,
  pending: PendingSession,
  runtimeSessionId: string,
): Promise<void> {
  try {
    const providerSessionId = await providerAdapter.waitForSessionId(pending);
    if (pending.exited) {
      return;
    }
    pending.providerSessionId = providerSessionId;
    pending.startupSettled = true;
    updateRuntimeSessionProviderSessionId(runtimeSessionId, providerSessionId);
    if (!sessionRuntimeMap.has(runtimeSessionId)) {
      return;
    }
    attachPrimarySessionByPath(pending.worktreePath, {
      provider: pending.provider,
      providerSessionId,
    });
    await refreshWorktreeWatcher();
    emitSessionsStateChanged();
  } catch {
    // Codex can stay active before it persists a resumable session; ignore resolution failures here.
  }
}

function killAllPty(): void {
  for (const proc of ptyProcesses.values()) {
    proc.kill();
  }
  for (const proc of pendingProcesses.values()) {
    proc.kill();
  }
  ptyProcesses.clear();
  ptyAttachments.clear();
  pendingProcesses.clear();
  ptyScrollback.clear();
}

function emitSessionsStateChanged(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("sessions:stateChanged");
}

async function findPrimarySessionResumeTarget(
  worktreeId: string,
  providerSessionKey: string,
): Promise<WorktreeSessionResumeTarget | null> {
  const worktree = await findGitWorktree(worktreeId);
  if (!worktree) {
    return null;
  }
  const taskWorktree = loadTaskWorktrees().find(
    (entry) =>
      entry.repoId === worktree.repoId &&
      path.resolve(entry.worktreePath) === path.resolve(worktree.worktreePath),
  );
  if (!taskWorktree?.primarySession) {
    return null;
  }

  const primarySessionKey = toSessionKey(
    taskWorktree.primarySession.provider,
    taskWorktree.primarySession.providerSessionId,
  );
  if (primarySessionKey !== providerSessionKey) {
    return null;
  }

  return {
    provider: taskWorktree.primarySession.provider,
    providerSessionId: taskWorktree.primarySession.providerSessionId,
    repoPath: worktree.repoPath,
    project: taskWorktree.worktreePath,
  };
}

async function findSuggestedSession(
  worktreePath: string,
  providerSessionKey: string,
): Promise<SuggestedWorktreeSession | null> {
  const suggestedSessions = await loadSuggestedWorktreeSessions([worktreePath]);
  return (
    (suggestedSessions.get(worktreePath) ?? []).find(
      (session) => toSessionKey(session.provider, session.providerSessionId) === providerSessionKey,
    ) ?? null
  );
}

async function findGitWorktree(
  worktreeId: string,
): Promise<{ repoId: string; repoPath: string; worktreePath: string } | null> {
  for (const repo of loadRepos()) {
    const worktrees = await listWorktrees(repo.repoPath).catch(() => []);
    const worktree = worktrees.find(
      (entry) => toWorktreeId(repo.id, entry.path) === worktreeId,
    );
    if (worktree) {
      return {
        repoId: repo.id,
        repoPath: repo.repoPath,
        worktreePath: worktree.path,
      };
    }
  }
  return null;
}

async function getWorkingRootForWorktree(worktreeId: string): Promise<string | null> {
  const worktree = await findGitWorktree(worktreeId);
  return worktree?.worktreePath ?? null;
}

function promotePrimarySession(
  worktree: { repoId: string; worktreePath: string },
  session: SuggestedWorktreeSession,
): void {
  upsertTaskWorktree(worktree.repoId, worktree.worktreePath);
  attachPrimarySessionByPath(worktree.worktreePath, {
    provider: session.provider,
    providerSessionId: session.providerSessionId,
  });
}

async function activateWorktreeSession(
  target: WorktreeSessionResumeTarget,
  options: { detachMissingPrimary: boolean },
): Promise<Result<string>> {
  const providerAdapter = getSessionProvider(target.provider);
  let pending: PendingSession | null = null;
  try {
    if (!(await providerAdapter.hasStoredSession(target.providerSessionId))) {
      if (options.detachMissingPrimary) {
        detachPrimarySessionByPath(target.project, {
          provider: target.provider,
          providerSessionId: target.providerSessionId,
        });
        emitSessionsStateChanged();
      }
      return failAndReport<string>({
        code: "command_failed",
        message: "This session no longer exists.",
        detail: `${target.provider} session ${target.providerSessionId} was not found in saved conversations.`,
      });
    }

    pending = launchPendingSession(
      providerAdapter,
      await providerAdapter.createResumeLaunch(target),
      "Failed to resume session",
    );
    await waitForResumeReady(providerAdapter, pending, target.providerSessionId);
    const runtimeSessionId = createRuntimeSessionId(target.provider, pending);
    registerRuntimeSession(runtimeSessionId, pending, target.providerSessionId);
    return ok(runtimeSessionId);
  } catch (error) {
    if (pending && !pending.exited) {
      pending.proc.kill();
    }
    const appError = isAppError(error)
      ? error
      : toAppError(error, { command: providerAdapter.command });
    return pending?.startupFailureReported
      ? fail<string>(appError)
      : failAndReport<string>(appError);
  }
}

async function resumePrimaryWorktreeSession(
  worktreeId: string,
  providerSessionKey: string,
): Promise<Result<WorktreeSessionSelection>> {
  const target = await findPrimarySessionResumeTarget(worktreeId, providerSessionKey);
  if (!target) {
    return failAndReport<WorktreeSessionSelection>({
      code: "unknown",
      message: "This primary session no longer exists.",
    });
  }

  const activeRuntimeSessionId = getActiveRuntimeSessionIdsByKey().get(providerSessionKey);
  if (activeRuntimeSessionId && ptyProcesses.has(activeRuntimeSessionId)) {
    return ok({ worktreeId, runtimeSessionId: activeRuntimeSessionId });
  }

  const result = await activateWorktreeSession(target, { detachMissingPrimary: true });
  if (result.ok) {
    return ok({ worktreeId, runtimeSessionId: result.data });
  }
  return result;
}

async function resumeSuggestedWorktreeSession(
  worktreeId: string,
  providerSessionKey: string,
): Promise<Result<WorktreeSessionSelection>> {
  const worktree = await findGitWorktree(worktreeId);
  if (!worktree) {
    return failAndReport<WorktreeSessionSelection>({
      code: "unknown",
      message: "This worktree no longer exists.",
    });
  }

  const suggestedSession = await findSuggestedSession(worktree.worktreePath, providerSessionKey);
  if (!suggestedSession) {
    return failAndReport<WorktreeSessionSelection>({
      code: "unknown",
      message: "This suggested session no longer exists.",
    });
  }

  promotePrimarySession(worktree, suggestedSession);
  return resumePrimaryWorktreeSession(worktreeId, providerSessionKey);
}

async function startSession(
  provider: SessionProvider,
  providerAdapter: SessionProviderAdapter,
  pending: PendingSession,
): Promise<StartedSession> {
  const runtimeSessionId = createRuntimeSessionId(provider, pending);

  if (providerAdapter.resolvesSessionIdLazily) {
    registerRuntimeSession(runtimeSessionId, pending, null);
    void resolveLazySessionId(providerAdapter, pending, runtimeSessionId);
    return {
      runtimeSessionId,
      providerSessionId: null,
    };
  }

  const providerSessionId = await providerAdapter.waitForSessionId(pending);
  registerRuntimeSession(runtimeSessionId, pending, providerSessionId);
  return {
    runtimeSessionId,
    providerSessionId,
  };
}

async function refreshWorktreeWatcher(): Promise<void> {
  if (!worktreeWatcher) {
    return;
  }
  const sessions = await loadSessions(sessionRuntimeMap);
  const repos = new Set(loadRepos().map((repo) => repo.repoPath));
  const sessionRepoPaths = sessions
    .filter((session) => session.worktree && session.state !== "archived")
    .map((session) => session.repoPath);
  for (const repoPath of sessionRepoPaths) {
    repos.add(repoPath);
  }
  worktreeWatcher.setRepos(Array.from(repos));
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
  });
  installApplicationMenu();
  createWindow();

  worktreeWatcher = new WorktreeWatcher();
  worktreeWatcher.onChange(() => {
    void refreshWorktreeWatcher();
    emitSessionsStateChanged();
  });
  void refreshWorktreeWatcher();

  ipcMain.handle("sessions:list", () => {
    return loadSessions(sessionRuntimeMap);
  });

  ipcMain.handle("metadata:listRepos", async () => {
    const previewsByKey = await loadStoredSessionPreviews();
    return loadRepoList(
      getActiveRuntimeSessionIdsByKey(),
      undefined,
      previewsByKey,
      loadSuggestedWorktreeSessions,
      getActiveRuntimeSessionsByWorktreePath(),
    );
  });

  ipcMain.handle("providers:list", () => {
    return listSessionProviderDefinitions();
  });

  ipcMain.handle("pty:attach", (_event, runtimeSessionId: string) => {
    ptyAttachments.set(runtimeSessionId, {
      ready: false,
      pendingChunks: [],
    });
    return ptyScrollback.get(runtimeSessionId) ?? "";
  });

  ipcMain.handle("pty:ready", (_event, runtimeSessionId: string) => {
    const attachment = ptyAttachments.get(runtimeSessionId);
    if (!attachment || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    attachment.ready = true;
    const pendingChunk = attachment.pendingChunks.join("");
    attachment.pendingChunks = [];
    if (pendingChunk) {
      mainWindow.webContents.send("pty:data", runtimeSessionId, pendingChunk);
    }
  });

  ipcMain.handle("pty:detach", (_event, runtimeSessionId: string) => {
    ptyAttachments.delete(runtimeSessionId);
  });

  ipcMain.handle("errors:list", () => {
    return listErrorNotices();
  });

  ipcMain.handle("errors:dismiss", (_event, id: string) => {
    if (dismissErrorNotice(id)) {
      emitErrorRemoved(id);
    }
  });

  ipcMain.handle("errors:clear", () => {
    if (clearErrorNotices()) {
      emitErrorsCleared();
    }
  });

  ipcMain.handle(
    "worktreeSession:resumePrimary",
    async (_event, worktreeId: string, providerSessionKey: string) => {
      return resumePrimaryWorktreeSession(worktreeId, providerSessionKey);
    },
  );

  ipcMain.handle(
    "worktreeSession:resumeSuggested",
    async (_event, worktreeId: string, providerSessionKey: string) => {
      return resumeSuggestedWorktreeSession(worktreeId, providerSessionKey);
    },
  );

  ipcMain.handle("session:create", async (_event, provider: SessionProvider, repoPath: string) => {
    const providerAdapter = getSessionProvider(provider);
    let pending: PendingSession | null = null;
    try {
      pending = launchPendingSession(
        providerAdapter,
        await providerAdapter.createNewLaunch(repoPath),
        "Failed to start session",
      );
      const { runtimeSessionId, providerSessionId } = await startSession(provider, providerAdapter, pending);
      pending.startupSettled = true;
      if (providerSessionId) {
        await refreshWorktreeWatcher();
      }
      return ok(runtimeSessionId);
    } catch (error) {
      if (pending && !pending.exited) {
        pending.proc.kill();
      }
      const appError = toAppError(error, { command: providerAdapter.command });
      return pending?.startupFailureReported
        ? fail<string>(appError)
        : failAndReport<string>(appError);
    }
  });

  ipcMain.handle(
    "session:createWorktree",
    async (_event, provider: SessionProvider, repoPath: string, branchName: string) => {
      const providerAdapter = getSessionProvider(provider);
      const worktreeName = branchName.replace(/\//g, "-");
      const worktreePath = providerAdapter.resolveWorktreePath(repoPath, worktreeName);
      const worktreeContext: WorktreeContext = {
        repoPath,
        worktreePath,
        worktreeName,
        branchName,
      };

      // Pre-check: worktree directory and branch name must not already exist
      if (fs.existsSync(worktreePath)) {
        return failAndReport<WorktreeSessionSelection>({
          code: "filesystem_failed",
          message: `Worktree "${worktreeName}" already exists`,
        });
      }
      if (await branchExists(repoPath, branchName)) {
        return failAndReport<WorktreeSessionSelection>({
          code: "git_failed",
          message: `Branch "${branchName}" already exists`,
        });
      }

      const repo = findRepoByPath(repoPath);
      if (!repo) {
        return failAndReport<WorktreeSessionSelection>({
          code: "unknown",
          message: `Repository "${repoPath}" is not registered in Yuru. Run \`yuru add\` first.`,
        });
      }

      let pending: PendingSession | null = null;
      try {
        await providerAdapter.prepareWorktree(worktreeContext);
        upsertTaskWorktree(repo.id, worktreePath);

        pending = launchPendingSession(
          providerAdapter,
          await providerAdapter.createWorktreeLaunch(worktreeContext),
          "Failed to create worktree session",
        );
        const { runtimeSessionId, providerSessionId } = await startSession(
          provider,
          providerAdapter,
          pending,
        );
        pending.startupSettled = true;
        if (providerSessionId) {
          attachPrimarySessionByPath(worktreePath, {
            provider,
            providerSessionId,
          });
        }
        await providerAdapter.finalizeWorktree(worktreeContext);
        worktreeWatcher?.addRepo(repoPath);
        return ok({
          worktreeId: toWorktreeId(repo.id, worktreePath),
          runtimeSessionId,
        });
      } catch (error) {
        if (pending && !pending.exited) {
          pending.proc.kill();
        }
        if (fs.existsSync(worktreePath)) {
          await removeWorktree(repoPath, worktreePath).catch(() => undefined);
        }
        removeTaskWorktreeByPath(worktreePath);
        const command = providerAdapter.command === "codex" ? "git" : providerAdapter.command;
        const appError = toAppError(error, { command });
        return pending?.startupFailureReported
          ? fail<WorktreeSessionSelection>(appError)
          : failAndReport<WorktreeSessionSelection>(appError);
      }
    },
  );

  ipcMain.handle(
    "worktree:remove",
    async (_event, _provider: SessionProvider, repoPath: string, worktreePath: string) => {
      if (hasActivePrimarySessionForWorktree(worktreePath)) {
        return failAndReport<boolean>({
          code: "unknown",
          message: "Stop the session before removing this worktree.",
        });
      }
      try {
        await removeWorktree(repoPath, worktreePath);
        removeTaskWorktreeByPath(worktreePath);
        return ok(true);
      } catch (error) {
        return failAndReport<boolean>(toAppError(error, { command: "git" }));
      }
    },
  );

  ipcMain.handle("dialog:selectFolder", async () => {
    if (!mainWindow) {
      return null;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select Repository",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("shell:openExternal", async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle("git:pathStates", async (_event, worktreeId: string) => {
    const workingRoot = await getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok([]);
    }
    try {
      return ok(await getGitPathStates(workingRoot));
    } catch {
      return ok([]);
    }
  });

  ipcMain.handle("git:branchContext", async (_event, worktreeId: string) => {
    const workingRoot = await getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok({ branch: null, github: null } satisfies BranchContext);
    }

    try {
      const branch = await getCurrentBranch(workingRoot);
      if (!branch) {
        return ok({ branch: null, github: null } satisfies BranchContext);
      }

      const repoPath = (await getRepoRootForProject(workingRoot)) ?? workingRoot;
      const github = await getGitHubPullRequestForBranch(repoPath, branch);
      return ok({ branch, github } satisfies BranchContext);
    } catch (error) {
      return failAndReport(toAppError(error, { command: "git" }));
    }
  });

  ipcMain.handle("git:diffDocument", async (_event, worktreeId: string, filePath: string) => {
    const workingRoot = await getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok(null);
    }
    try {
      return ok(await getGitDiffDocument(workingRoot, filePath));
    } catch (error) {
      return failAndReport(toAppError(error, { command: "git" }));
    }
  });

  ipcMain.handle("files:list", async (_event, worktreeId: string, relativePath?: string) => {
    const workingRoot = await getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok([]);
    }
    try {
      return ok(await listFiles(workingRoot, relativePath ?? ""));
    } catch (error) {
      return failAndReport(toAppError(error));
    }
  });

  ipcMain.handle("files:listAll", async (_event, worktreeId: string) => {
    const workingRoot = await getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok([] as string[]);
    }
    try {
      return ok(await listAllFiles(workingRoot));
    } catch (error) {
      return failAndReport(toAppError(error, { command: "git" }));
    }
  });

  ipcMain.handle("files:resolveRepoFile", async (_event, worktreeId: string, filePath: string) => {
    const workingRoot = await getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return null;
    }
    return resolveRepoFile(workingRoot, filePath);
  });

  ipcMain.handle("files:syncWatchTargets", async (_event, worktreeId: string, relativePaths: string[]) => {
    const workingRoot = await getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      fileTreeWatcher.clearSession(worktreeId);
      return;
    }

    await fileTreeWatcher.syncSessionTargets(worktreeId, workingRoot, relativePaths);
  });

  ipcMain.on("pty:write", (_event, runtimeSessionId: string, data: string) => {
    const proc = ptyProcesses.get(runtimeSessionId);
    if (proc) {
      proc.write(data);
    }
  });

  ipcMain.on("pty:resize", (_event, runtimeSessionId: string, cols: number, rows: number) => {
    const proc = ptyProcesses.get(runtimeSessionId);
    if (proc) {
      proc.resize(cols, rows);
    }
  });
});

app.on("window-all-closed", () => {
  if (worktreeWatcher) {
    worktreeWatcher.stop();
  }
  fileTreeWatcher.stop();
  killAllPty();
  app.quit();
});
