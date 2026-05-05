import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import crypto from "crypto";
import path from "path";
import * as pty from "node-pty";
import {
  type ActiveRuntimeSessionListItem,
  attachPrimarySession,
  detachPrimarySessionByPath,
  findRepoByPath,
  loadRepoList,
  loadRepos,
  loadTaskWorktrees,
  removeTaskWorktreeByPath,
  upsertTaskWorktree,
} from "./metadata.js";
import { loadSessions, loadStoredSessionPreviews } from "./sessions.js";
import {
  getGitPathStates,
  getGitDiffDocument,
  getCurrentBranch,
  getRepoRootForProject,
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
  type ActiveSessionState,
  type AppError,
  type AppErrorNotice,
  type BranchContext,
  type Result,
  type RuntimeSessionSelection,
} from "../shared/ipc.js";
import {
  type SessionProvider,
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

interface WorktreeSessionSelection {
  activeRuntimeSessionId: string | null;
  provider: SessionProvider;
  providerSessionId: string;
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

function getWorkingRootForRuntimeSession(runtimeSessionId: string): string | null {
  const runtime = sessionRuntimeMap.get(runtimeSessionId);
  return runtime?.cwd ?? null;
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

function getActiveRuntimeSessionsByTaskWorktreeId(): Map<string, ActiveRuntimeSessionListItem> {
  const sessionsByTaskWorktreeId = new Map<string, ActiveRuntimeSessionListItem>();
  for (const [runtimeSessionId, info] of sessionRuntimeMap) {
    if (!info.taskWorktreeId) {
      continue;
    }
    sessionsByTaskWorktreeId.set(info.taskWorktreeId, {
      runtimeSessionId,
      provider: info.provider,
      providerSessionId: info.providerSessionId,
    });
  }
  return sessionsByTaskWorktreeId;
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
    launchLabel,
    outputBuffer: "",
    startupOutput: "",
    sessionCwd: request.sessionCwd,
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
      cwd: pending.sessionCwd,
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
  taskWorktreeId?: string,
): void {
  pending.providerSessionId = providerSessionId;
  pending.runtimeSessionId = runtimeSessionId;
  pendingProcesses.delete(pending.proc);
  ptyProcesses.set(runtimeSessionId, pending.proc);
  ptyScrollback.set(runtimeSessionId, pending.outputBuffer);
  sessionRuntimeMap.set(runtimeSessionId, {
    cwd: pending.sessionCwd,
    provider: pending.provider,
    providerSessionId,
    startedAt: pending.startedAt,
    taskWorktreeId,
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
    const taskWorktreeId = sessionRuntimeMap.get(runtimeSessionId)?.taskWorktreeId;
    if (taskWorktreeId) {
      attachPrimarySession(taskWorktreeId, {
        provider: pending.provider,
        providerSessionId,
      });
    }
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
  const activeSessions: ActiveSessionState[] = Array.from(sessionRuntimeMap, ([runtimeSessionId, info]) => ({
    runtimeSessionId,
    cwd: info.cwd,
  }));
  mainWindow.webContents.send("sessions:stateChanged", activeSessions);
}

function buildRuntimeSessionSelection(runtimeSessionId: string): RuntimeSessionSelection {
  return { runtimeSessionId };
}

function findWorktreeSessionSelection(
  taskWorktreeId: string,
  providerSessionKey: string,
): WorktreeSessionSelection | null {
  const taskWorktree = loadTaskWorktrees().find(
    (entry) => entry.taskWorktreeId === taskWorktreeId,
  );
  const primarySession = taskWorktree?.primarySession;
  if (!taskWorktree || !primarySession) {
    return null;
  }

  const primarySessionKey = toSessionKey(
    primarySession.provider,
    primarySession.providerSessionId,
  );
  if (primarySessionKey !== providerSessionKey) {
    return null;
  }

  return {
    activeRuntimeSessionId: getActiveRuntimeSessionIdsByKey().get(primarySessionKey) ?? null,
    provider: primarySession.provider,
    providerSessionId: primarySession.providerSessionId,
    project: taskWorktree.worktreePath,
  };
}

async function startSession(
  provider: SessionProvider,
  providerAdapter: SessionProviderAdapter,
  pending: PendingSession,
  taskWorktreeId?: string,
): Promise<StartedSession> {
  const runtimeSessionId = createRuntimeSessionId(provider, pending);

  if (providerAdapter.resolvesSessionIdLazily) {
    registerRuntimeSession(runtimeSessionId, pending, null, taskWorktreeId);
    void resolveLazySessionId(providerAdapter, pending, runtimeSessionId);
    return {
      runtimeSessionId,
      providerSessionId: null,
    };
  }

  const providerSessionId = await providerAdapter.waitForSessionId(pending);
  registerRuntimeSession(runtimeSessionId, pending, providerSessionId, taskWorktreeId);
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
    for (const [runtimeSessionId, info] of sessionRuntimeMap) {
      if (fs.existsSync(info.cwd)) {
        continue;
      }
      const proc = ptyProcesses.get(runtimeSessionId);
      if (proc) {
        proc.kill();
      }
    }
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
      getActiveRuntimeSessionsByTaskWorktreeId(),
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
    "worktreeSession:select",
    async (_event, taskWorktreeId: string, providerSessionKey: string) => {
      const selection = await findWorktreeSessionSelection(taskWorktreeId, providerSessionKey);
      if (!selection) {
        return failAndReport<RuntimeSessionSelection>({
          code: "unknown",
          message: "This worktree session no longer exists.",
        });
      }
      if (selection.activeRuntimeSessionId && ptyProcesses.has(selection.activeRuntimeSessionId)) {
        return ok(buildRuntimeSessionSelection(selection.activeRuntimeSessionId));
      }
      const providerAdapter = getSessionProvider(selection.provider);
      let pending: PendingSession | null = null;
      try {
        if (!(await providerAdapter.hasStoredSession(selection.providerSessionId))) {
          detachPrimarySessionByPath(selection.project, {
            provider: selection.provider,
            providerSessionId: selection.providerSessionId,
          });
          emitSessionsStateChanged();
          return failAndReport<RuntimeSessionSelection>({
            code: "command_failed",
            message: "This session no longer exists.",
            detail: `${selection.provider} session ${selection.providerSessionId} was not found in saved conversations.`,
          });
        }

        pending = launchPendingSession(
          providerAdapter,
          await providerAdapter.createResumeLaunch(selection),
          "Failed to resume session",
        );
        await waitForResumeReady(providerAdapter, pending, selection.providerSessionId);
        const runtimeSessionId = createRuntimeSessionId(selection.provider, pending);
        registerRuntimeSession(runtimeSessionId, pending, selection.providerSessionId);
        emitSessionsStateChanged();
        return ok(buildRuntimeSessionSelection(runtimeSessionId));
      } catch (error) {
        if (pending && !pending.exited) {
          pending.proc.kill();
        }
        const appError = isAppError(error)
          ? error
          : toAppError(error, { command: providerAdapter.command });
        return pending?.startupFailureReported
          ? fail<RuntimeSessionSelection>(appError)
          : failAndReport<RuntimeSessionSelection>(appError);
      }
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
      return ok(buildRuntimeSessionSelection(runtimeSessionId));
    } catch (error) {
      if (pending && !pending.exited) {
        pending.proc.kill();
      }
      const appError = toAppError(error, { command: providerAdapter.command });
      return pending?.startupFailureReported
        ? fail<RuntimeSessionSelection>(appError)
        : failAndReport<RuntimeSessionSelection>(appError);
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
        return failAndReport<RuntimeSessionSelection>({
          code: "filesystem_failed",
          message: `Worktree "${worktreeName}" already exists`,
        });
      }
      if (await branchExists(repoPath, branchName)) {
        return failAndReport<RuntimeSessionSelection>({
          code: "git_failed",
          message: `Branch "${branchName}" already exists`,
        });
      }

      const repo = findRepoByPath(repoPath);
      if (!repo) {
        return failAndReport<RuntimeSessionSelection>({
          code: "unknown",
          message: `Repository "${repoPath}" is not registered in Yuru. Run \`yuru add\` first.`,
        });
      }

      const taskWorktreeId = crypto.randomUUID();
      let pending: PendingSession | null = null;
      try {
        await providerAdapter.prepareWorktree(worktreeContext);
        upsertTaskWorktree(taskWorktreeId, repo.id, worktreePath);

        pending = launchPendingSession(
          providerAdapter,
          await providerAdapter.createWorktreeLaunch(worktreeContext),
          "Failed to create worktree session",
        );
        const { runtimeSessionId, providerSessionId } = await startSession(
          provider,
          providerAdapter,
          pending,
          taskWorktreeId,
        );
        pending.startupSettled = true;
        if (providerSessionId) {
          attachPrimarySession(taskWorktreeId, {
            provider,
            providerSessionId,
          });
        }
        await providerAdapter.finalizeWorktree(worktreeContext);
        await refreshWorktreeWatcher();
        return ok(buildRuntimeSessionSelection(runtimeSessionId));
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
          ? fail<RuntimeSessionSelection>(appError)
          : failAndReport<RuntimeSessionSelection>(appError);
      }
    },
  );

  ipcMain.handle(
    "worktree:remove",
    async (_event, _provider: SessionProvider, repoPath: string, worktreePath: string) => {
      const activeSessionExists = Array.from(sessionRuntimeMap.values()).some(
        (runtime) => runtime.cwd === worktreePath,
      );
      if (activeSessionExists) {
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

  ipcMain.handle("git:pathStates", async (_event, runtimeSessionId: string) => {
    const workingRoot = getWorkingRootForRuntimeSession(runtimeSessionId);
    if (!workingRoot) {
      return ok([]);
    }
    try {
      return ok(await getGitPathStates(workingRoot));
    } catch {
      return ok([]);
    }
  });

  ipcMain.handle("git:branchContext", async (_event, runtimeSessionId: string) => {
    const runtime = sessionRuntimeMap.get(runtimeSessionId);
    if (!runtime) {
      return ok({ branch: null, github: null } satisfies BranchContext);
    }

    try {
      const branch = await getCurrentBranch(runtime.cwd);
      if (!branch) {
        return ok({ branch: null, github: null } satisfies BranchContext);
      }

      const repoPath = (await getRepoRootForProject(runtime.cwd)) ?? runtime.cwd;
      const github = await getGitHubPullRequestForBranch(repoPath, branch);
      return ok({ branch, github } satisfies BranchContext);
    } catch (error) {
      return failAndReport(toAppError(error, { command: "git" }));
    }
  });

  ipcMain.handle("git:diffDocument", async (_event, runtimeSessionId: string, filePath: string) => {
    const workingRoot = getWorkingRootForRuntimeSession(runtimeSessionId);
    if (!workingRoot) {
      return ok(null);
    }
    try {
      return ok(await getGitDiffDocument(workingRoot, filePath));
    } catch (error) {
      return failAndReport(toAppError(error, { command: "git" }));
    }
  });

  ipcMain.handle("files:list", async (_event, runtimeSessionId: string, relativePath?: string) => {
    const workingRoot = getWorkingRootForRuntimeSession(runtimeSessionId);
    if (!workingRoot) {
      return ok([]);
    }
    try {
      return ok(await listFiles(workingRoot, relativePath ?? ""));
    } catch (error) {
      return failAndReport(toAppError(error));
    }
  });

  ipcMain.handle("files:listAll", async (_event, runtimeSessionId: string) => {
    const workingRoot = getWorkingRootForRuntimeSession(runtimeSessionId);
    if (!workingRoot) {
      return ok([] as string[]);
    }
    try {
      return ok(await listAllFiles(workingRoot));
    } catch (error) {
      return failAndReport(toAppError(error, { command: "git" }));
    }
  });

  ipcMain.handle("files:resolveRepoFile", (_event, runtimeSessionId: string, filePath: string) => {
    const workingRoot = getWorkingRootForRuntimeSession(runtimeSessionId);
    if (!workingRoot) {
      return null;
    }
    return resolveRepoFile(workingRoot, filePath);
  });

  ipcMain.handle("files:syncWatchTargets", async (_event, runtimeSessionId: string, relativePaths: string[]) => {
    const workingRoot = getWorkingRootForRuntimeSession(runtimeSessionId);
    if (!workingRoot) {
      fileTreeWatcher.clearSession(runtimeSessionId);
      return;
    }

    await fileTreeWatcher.syncSessionTargets(runtimeSessionId, workingRoot, relativePaths);
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
