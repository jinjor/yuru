import { app, BrowserWindow, Menu, ipcMain } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import path from "path";
import { loadRepos } from "./metadata.js";
import { cleanupStaleTaskWorktrees } from "./task-worktree-maintenance.js";
import { WorktreeWatcher } from "./worktree-watcher.js";
import { YuruService } from "./service.js";
import { APP_NAME, getWindowTitleForAppPath } from "./app-title.js";
import type { AppErrorNotice, GitDiffScope, SessionUpdate } from "../shared/ipc.js";
import type { SessionProvider } from "../shared/session.js";

let mainWindow: BrowserWindow | null = null;
let worktreeWatcher: WorktreeWatcher | null = null;
let servicesStopped = false;

const HIDE_WINDOW_FOR_E2E = process.env.YURU_E2E_HIDE_WINDOW === "1";

app.setName(APP_NAME);

const service = new YuruService({
  fileTreeChanged: sendFileTreeChanged,
  ptyData: sendPtyData,
  terminalRuntimeExited: sendTerminalRuntimeExited,
  sessionChanged: sendSessionChanged,
  repoListChanged: sendRepoListChanged,
  errorAdded: sendErrorAdded,
  refreshWorktreeWatcher,
  addWorktreeWatcherRepo,
});

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, ...args);
}

function sendFileTreeChanged(worktreeId: string, relativePath: string): void {
  sendToRenderer("files:changed", worktreeId, relativePath);
}

function sendPtyData(terminalRuntimeId: string, data: string): void {
  sendToRenderer("pty:data", terminalRuntimeId, data);
}

function sendTerminalRuntimeExited(terminalRuntimeId: string): void {
  sendToRenderer("terminalRuntime:exited", terminalRuntimeId);
}

function sendSessionChanged(terminalRuntimeId: string, update: SessionUpdate): void {
  sendToRenderer("session:changed", terminalRuntimeId, update);
}

function sendRepoListChanged(): void {
  sendToRenderer("repos:changed");
}

function sendErrorAdded(notice: AppErrorNotice): void {
  sendToRenderer("errors:added", notice);
}

function sendErrorRemoved(id: string): void {
  sendToRenderer("errors:removed", id);
}

function sendErrorsCleared(): void {
  sendToRenderer("errors:cleared");
}

function addWorktreeWatcherRepo(repoPath: string): void {
  worktreeWatcher?.addRepo(repoPath);
}

function logStartupMaintenanceError(repoPath: string, error: unknown): void {
  console.warn(`[Yuru] Skipped stale task worktree cleanup for ${repoPath}.`, error);
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

async function createWindow(): Promise<void> {
  const windowTitle = await getWindowTitleForAppPath(app.getAppPath());
  mainWindow = new BrowserWindow({
    title: windowTitle,
    width: 1400,
    height: 900,
    show: !HIDE_WINDOW_FOR_E2E,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow?.setTitle(windowTitle);
  });

  await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

async function refreshWorktreeWatcher(): Promise<void> {
  if (!worktreeWatcher) {
    return;
  }
  worktreeWatcher.setRepos(loadRepos().map((repo) => repo.repoPath));
}

async function stopApplicationServices(): Promise<void> {
  if (servicesStopped) {
    return;
  }
  servicesStopped = true;
  worktreeWatcher?.stop();
  await service.stop();
}

function registerIpcHandlers(): void {
  ipcMain.handle("metadata:listRepos", () => service.getRepos());
  ipcMain.handle("providers:list", () => service.getSessionProviders());

  ipcMain.handle("pty:attach", (_event, terminalRuntimeId: string) => {
    return service.attachPty(terminalRuntimeId);
  });

  ipcMain.handle("pty:ready", (_event, terminalRuntimeId: string) => {
    const pendingChunk = service.readyPty(terminalRuntimeId);
    if (pendingChunk) {
      sendPtyData(terminalRuntimeId, pendingChunk);
    }
  });

  ipcMain.handle("pty:detach", (_event, terminalRuntimeId: string) => {
    service.detachPty(terminalRuntimeId);
  });

  ipcMain.handle("errors:list", () => service.getErrors());

  ipcMain.handle("errors:dismiss", (_event, id: string) => {
    if (service.dismissError(id)) {
      sendErrorRemoved(id);
    }
  });

  ipcMain.handle("errors:clear", () => {
    if (service.clearErrors()) {
      sendErrorsCleared();
    }
  });

  ipcMain.handle(
    "worktreeSession:resumePrimary",
    (_event, worktreeId: string, providerSessionKey: string) => {
      return service.resumePrimarySession(worktreeId, providerSessionKey);
    },
  );

  ipcMain.handle(
    "worktreeSession:resumeSuggested",
    (_event, worktreeId: string, providerSessionKey: string) => {
      return service.resumeSuggestedSession(worktreeId, providerSessionKey);
    },
  );

  ipcMain.handle(
    "worktreeSession:create",
    (_event, worktreeId: string, provider: SessionProvider) => {
      return service.createSessionForWorktree(worktreeId, provider);
    },
  );

  ipcMain.handle("worktreeTerminal:open", (_event, worktreeId: string) => {
    return service.openWorktreeTerminal(worktreeId);
  });

  ipcMain.handle(
    "session:createWorktree",
    (_event, provider: SessionProvider, repoPath: string, branchName: string) => {
      return service.createWorktreeSession(provider, repoPath, branchName);
    },
  );

  ipcMain.handle("worktree:remove", (_event, worktreeId: string, force: boolean) => {
    return service.removeWorktree(worktreeId, force);
  });

  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    return service.openExternal(url);
  });

  ipcMain.handle("git:pathStates", (_event, worktreeId: string) => {
    return service.getGitPathStates(worktreeId);
  });

  ipcMain.handle(
    "git:diffDocument",
    (_event, worktreeId: string, filePath: string, scope?: GitDiffScope) => {
      return service.getGitDiffDocument(worktreeId, filePath, scope);
    },
  );

  ipcMain.handle("files:list", (_event, worktreeId: string, relativePath?: string) => {
    return service.listFiles(worktreeId, relativePath);
  });

  ipcMain.handle("files:listAll", (_event, worktreeId: string) => {
    return service.listAllFiles(worktreeId);
  });

  ipcMain.handle("files:resolveRepoFile", (_event, worktreeId: string, filePath: string) => {
    return service.resolveRepoFile(worktreeId, filePath);
  });

  ipcMain.handle("files:readWorktree", (_event, worktreeId: string, filePath: string) => {
    return service.readWorktreeFile(worktreeId, filePath);
  });

  ipcMain.handle("files:write", (_event, worktreeId: string, filePath: string, content: string) => {
    return service.writeFile(worktreeId, filePath, content);
  });

  ipcMain.handle(
    "files:syncWatchTargets",
    (_event, worktreeId: string, relativePaths: string[]) => {
      return service.syncFileWatchTargets(worktreeId, relativePaths);
    },
  );

  ipcMain.handle("search:code", (_event, worktreeId: string, query: string) => {
    return service.searchCode(worktreeId, query);
  });

  ipcMain.handle("search:cancelCode", (_event, worktreeId: string) => {
    service.cancelCodeSearch(worktreeId);
  });

  ipcMain.on("pty:write", (_event, terminalRuntimeId: string, data: string) => {
    service.ptyWrite(terminalRuntimeId, data);
  });

  ipcMain.on("pty:resize", (_event, terminalRuntimeId: string, cols: number, rows: number) => {
    service.ptyResize(terminalRuntimeId, cols, rows);
  });
}

app.whenReady().then(async () => {
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
  });
  const cleanupResult = await cleanupStaleTaskWorktrees();
  for (const skippedRepo of cleanupResult.skippedRepos) {
    logStartupMaintenanceError(skippedRepo.repoPath, skippedRepo.error);
  }
  installApplicationMenu();
  await createWindow();

  worktreeWatcher = new WorktreeWatcher();
  worktreeWatcher.onChange(() => {
    void refreshWorktreeWatcher();
    sendRepoListChanged();
  });
  void refreshWorktreeWatcher();
  registerIpcHandlers();
});

app.on("before-quit", (event) => {
  if (servicesStopped) {
    return;
  }
  // Hold off the quit until every PTY has been reaped, then quit for real.
  event.preventDefault();
  void stopApplicationServices().then(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
