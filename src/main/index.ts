import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import path from "path";
import * as pty from "node-pty";
import { loadSessions } from "./sessions.js";
import {
  getGitPathStates,
  getGitDiffDocument,
  getCurrentBranch,
  getRepoRootForProject,
  removeWorktree,
  branchExists,
} from "./git.js";
import { getGitHubPullRequestForBranch } from "./github.js";
import { listFiles, readFileContent, fileExists } from "./files.js";
import {
  getSessionProvider,
  listSessionProviderDefinitions,
} from "./agent-registry.js";
import {
  LaunchRequest,
  PendingSession,
  RuntimeSessionInfo,
  SessionProviderAdapter,
  WorktreeContext,
} from "./agent.js";
import { WorktreeWatcher } from "./worktree-watcher.js";
import { FileTreeWatcher } from "./file-tree-watcher.js";
import fs from "fs";
import {
  ActiveSessionState,
  AppError,
  AppErrorNotice,
  BranchContext,
  Result,
} from "../shared/ipc.js";
import {
  isResumableSession,
  Session,
  SessionProvider,
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

let mainWindow: BrowserWindow | null = null;
const ptyProcesses = new Map<string, pty.IPty>();
const ptyScrollback = new Map<string, string>();
const ptyAttachments = new Map<string, { ready: boolean; pendingChunks: string[] }>();
const pendingProcesses = new Set<pty.IPty>();
const sessionRuntimeMap = new Map<string, RuntimeSessionInfo>();
let worktreeWatcher: WorktreeWatcher | null = null;
const fileTreeWatcher = new FileTreeWatcher((sessionId, relativePath) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("files:changed", sessionId, relativePath);
});
const APP_NAME = "Yuru";
const STARTUP_OUTPUT_LIMIT = 4000;
const TERMINAL_SCROLLBACK_LIMIT = 200000;
const ESCAPE_CHARACTER = String.fromCharCode(0x1b);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-9;]*[A-Za-z]`, "g");

app.setName(APP_NAME);

interface StartedSession {
  sessionId: string;
  providerSessionId: string | null;
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
  const proc = pty.spawn(providerAdapter.command, request.args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: request.cwd,
    env: createTerminalEnv(process.env),
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
    appSessionId: null,
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
    if (!pending.appSessionId || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    ptyScrollback.set(
      pending.appSessionId,
      appendTerminalOutput(ptyScrollback.get(pending.appSessionId) ?? "", data),
    );
    const attachment = ptyAttachments.get(pending.appSessionId);
    if (!attachment) {
      return;
    }
    if (!attachment.ready) {
      attachment.pendingChunks.push(data);
      return;
    }
    mainWindow.webContents.send("pty:data", pending.appSessionId, data);
  });

  proc.onExit(({ exitCode, signal }) => {
    pending.exited = true;
    pendingProcesses.delete(proc);
    if (!pending.startupSettled && !pending.startupFailureReported) {
      pending.startupFailureReported = true;
      reportError(startupFailureMessage(pending, exitCode, signal));
    }
    if (!pending.appSessionId) {
      return;
    }
    ptyProcesses.delete(pending.appSessionId);
    ptyAttachments.delete(pending.appSessionId);
    fileTreeWatcher.clearSession(pending.appSessionId);
    sessionRuntimeMap.delete(pending.appSessionId);
    void refreshWorktreeWatcher();
    emitSessionsStateChanged();
  });

  return pending;
}

function registerSession(
  appSessionId: string,
  pending: PendingSession,
  providerSessionId: string | null,
): void {
  pending.providerSessionId = providerSessionId;
  pending.appSessionId = appSessionId;
  pendingProcesses.delete(pending.proc);
  ptyProcesses.set(appSessionId, pending.proc);
  ptyScrollback.set(appSessionId, pending.outputBuffer);
  sessionRuntimeMap.set(appSessionId, {
    cwd: pending.sessionCwd,
    provider: pending.provider,
    providerSessionId,
    startedAt: pending.startedAt,
  });
}

function updateRuntimeSessionProviderSessionId(appSessionId: string, providerSessionId: string): void {
  const runtime = sessionRuntimeMap.get(appSessionId);
  if (runtime) {
    sessionRuntimeMap.set(appSessionId, {
      ...runtime,
      providerSessionId,
    });
  }
}

async function resolveLazySessionId(
  providerAdapter: SessionProviderAdapter,
  pending: PendingSession,
  appSessionId: string,
): Promise<void> {
  try {
    const providerSessionId = await providerAdapter.waitForSessionId(pending);
    if (pending.exited) {
      return;
    }
    pending.providerSessionId = providerSessionId;
    pending.startupSettled = true;
    updateRuntimeSessionProviderSessionId(appSessionId, providerSessionId);
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
  const activeSessions: ActiveSessionState[] = Array.from(sessionRuntimeMap, ([sessionId, info]) => ({
    sessionId,
    cwd: info.cwd,
  }));
  mainWindow.webContents.send("sessions:stateChanged", activeSessions);
}

function buildActiveSession(params: {
  sessionId: string;
  provider: SessionProvider;
  providerSessionId: string | null;
  project: string;
  repoPath: string;
  worktree?: Session["worktree"];
}): Session {
  const { sessionId, provider, providerSessionId, project, repoPath, worktree } = params;
  return {
    id: sessionId,
    provider,
    providerSessionId,
    project,
    projectName: path.basename(project),
    repoPath,
    lastMessage: "",
    timestamp: Date.now(),
    state: "active",
    worktree,
  };
}

async function startSession(
  provider: SessionProvider,
  providerAdapter: SessionProviderAdapter,
  pending: PendingSession,
): Promise<StartedSession> {
  if (providerAdapter.resolvesSessionIdLazily) {
    const sessionId = toRuntimeSessionKey(provider, pending.startedAt);
    registerSession(sessionId, pending, null);
    void resolveLazySessionId(providerAdapter, pending, sessionId);
    return {
      sessionId,
      providerSessionId: null,
    };
  }

  const providerSessionId = await providerAdapter.waitForSessionId(pending);
  const sessionId = toSessionKey(provider, providerSessionId);
  registerSession(sessionId, pending, providerSessionId);
  return {
    sessionId,
    providerSessionId,
  };
}

async function refreshWorktreeWatcher(): Promise<void> {
  if (!worktreeWatcher) {
    return;
  }
  const sessions = await loadSessions(sessionRuntimeMap);
  const repos = Array.from(
    new Set(
      sessions
        .filter((session) => session.worktree && session.state !== "archived")
        .map((session) => session.repoPath),
    ),
  );
  worktreeWatcher.setRepos(repos);
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
    for (const [sessionId, info] of sessionRuntimeMap) {
      if (fs.existsSync(info.cwd)) {
        continue;
      }
      const proc = ptyProcesses.get(sessionId);
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

  ipcMain.handle("providers:list", () => {
    return listSessionProviderDefinitions();
  });

  ipcMain.handle("pty:attach", (_event, sessionId: string) => {
    ptyAttachments.set(sessionId, {
      ready: false,
      pendingChunks: [],
    });
    return ptyScrollback.get(sessionId) ?? "";
  });

  ipcMain.handle("pty:ready", (_event, sessionId: string) => {
    const attachment = ptyAttachments.get(sessionId);
    if (!attachment || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    attachment.ready = true;
    const pendingChunk = attachment.pendingChunks.join("");
    attachment.pendingChunks = [];
    if (pendingChunk) {
      mainWindow.webContents.send("pty:data", sessionId, pendingChunk);
    }
  });

  ipcMain.handle("pty:detach", (_event, sessionId: string) => {
    ptyAttachments.delete(sessionId);
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

  ipcMain.handle("session:select", async (_event, session: Session) => {
    if (session.state === "archived") {
      return failAndReport<boolean>({
        code: "unknown",
        message: "Archived sessions cannot be resumed.",
      });
    }
    if (!isResumableSession(session)) {
      return failAndReport<boolean>({
        code: "unknown",
        message: "This session cannot be resumed.",
      });
    }
    if (ptyProcesses.has(session.id)) {
      return ok(true);
    }
    const providerAdapter = getSessionProvider(session.provider);
    try {
      const pending = launchPendingSession(
        providerAdapter,
        await providerAdapter.createResumeLaunch(session),
        "Failed to resume session",
      );
      registerSession(session.id, pending, session.providerSessionId);
      emitSessionsStateChanged();
      return ok(true);
    } catch (error) {
      return failAndReport<boolean>(toAppError(error, { command: providerAdapter.command }));
    }
  });

  ipcMain.handle("session:create", async (_event, provider: SessionProvider, repoPath: string) => {
    const providerAdapter = getSessionProvider(provider);
    let pending: PendingSession | null = null;
    try {
      pending = launchPendingSession(
        providerAdapter,
        await providerAdapter.createNewLaunch(repoPath),
        "Failed to start session",
      );
      const { sessionId, providerSessionId } = await startSession(provider, providerAdapter, pending);
      pending.startupSettled = true;
      if (providerSessionId) {
        await refreshWorktreeWatcher();
      }
      return ok(
        buildActiveSession({
          sessionId,
          provider,
          providerSessionId,
          project: repoPath,
          repoPath,
        }),
      );
    } catch (error) {
      if (pending && !pending.exited) {
        pending.proc.kill();
      }
      const appError = toAppError(error, { command: providerAdapter.command });
      return pending?.startupFailureReported ? fail<Session>(appError) : failAndReport<Session>(appError);
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
        return failAndReport<Session>({
          code: "filesystem_failed",
          message: `Worktree "${worktreeName}" already exists`,
        });
      }
      if (await branchExists(repoPath, branchName)) {
        return failAndReport<Session>({
          code: "git_failed",
          message: `Branch "${branchName}" already exists`,
        });
      }

      let pending: PendingSession | null = null;
      try {
        await providerAdapter.prepareWorktree(worktreeContext);

        pending = launchPendingSession(
          providerAdapter,
          await providerAdapter.createWorktreeLaunch(worktreeContext),
          "Failed to create worktree session",
        );
        const { sessionId, providerSessionId } = await startSession(provider, providerAdapter, pending);
        pending.startupSettled = true;
        await providerAdapter.finalizeWorktree(worktreeContext);
        await refreshWorktreeWatcher();
        return ok(
          buildActiveSession({
            sessionId,
            provider,
            providerSessionId,
            project: worktreePath,
            repoPath,
            worktree: {
              name: worktreeName,
              branch: branchName,
            },
          }),
        );
      } catch (error) {
        if (pending && !pending.exited) {
          pending.proc.kill();
        }
        if (fs.existsSync(worktreePath)) {
          await removeWorktree(repoPath, worktreePath).catch(() => undefined);
        }
        const command = providerAdapter.command === "codex" ? "git" : providerAdapter.command;
        const appError = toAppError(error, { command });
        return pending?.startupFailureReported ? fail<Session>(appError) : failAndReport<Session>(appError);
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

  ipcMain.handle("git:pathStates", async (_event, sessionId: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      return ok([]);
    }
    try {
      return ok(await getGitPathStates(runtime.cwd));
    } catch {
      return ok([]);
    }
  });

  ipcMain.handle("git:branchContext", async (_event, sessionId: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
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

  ipcMain.handle("git:diffDocument", async (_event, sessionId: string, filePath: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      return ok(null);
    }
    try {
      return ok(await getGitDiffDocument(runtime.cwd, filePath));
    } catch (error) {
      return failAndReport(toAppError(error, { command: "git" }));
    }
  });

  ipcMain.handle("files:list", async (_event, sessionId: string, relativePath?: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      return ok([]);
    }
    try {
      return ok(await listFiles(runtime.cwd, relativePath ?? ""));
    } catch (error) {
      return failAndReport(toAppError(error));
    }
  });

  ipcMain.handle("files:read", async (_event, sessionId: string, filePath: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      return ok(null);
    }
    try {
      return ok(await readFileContent(runtime.cwd, filePath));
    } catch (error) {
      return failAndReport(toAppError(error));
    }
  });

  ipcMain.handle("files:exists", (_event, sessionId: string, filePath: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      return false;
    }
    return fileExists(runtime.cwd, filePath);
  });

  ipcMain.handle("files:syncWatchTargets", async (_event, sessionId: string, relativePaths: string[]) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      fileTreeWatcher.clearSession(sessionId);
      return;
    }

    await fileTreeWatcher.syncSessionTargets(sessionId, runtime.cwd, relativePaths);
  });

  ipcMain.on("pty:write", (_event, sessionId: string, data: string) => {
    const proc = ptyProcesses.get(sessionId);
    if (proc) {
      proc.write(data);
    }
  });

  ipcMain.on("pty:resize", (_event, sessionId: string, cols: number, rows: number) => {
    const proc = ptyProcesses.get(sessionId);
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
