import { app, BrowserWindow, Menu, ipcMain } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import path from "path";
import { loadRepos } from "./metadata.js";
import { cleanupStaleTaskWorktrees } from "./task-worktree-maintenance.js";
import { WorktreeWatcher } from "./worktree-watcher.js";
import { YuruService } from "./service.js";
import type { AppErrorNotice, WorktreeDisplayUpdate } from "../shared/ipc.js";
import type { SessionProvider } from "../shared/session.js";

let mainWindow: BrowserWindow | null = null;
let worktreeWatcher: WorktreeWatcher | null = null;

const APP_NAME = "Yuru";

app.setName(APP_NAME);

const service = new YuruService({
  fileTreeChanged: sendFileTreeChanged,
  ptyData: sendPtyData,
  worktreeDisplayChanged: sendWorktreeDisplayChanged,
  sessionsStateChanged: sendSessionsStateChanged,
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

function sendFileTreeChanged(runtimeSessionId: string, relativePath: string): void {
  sendToRenderer("files:changed", runtimeSessionId, relativePath);
}

function sendPtyData(runtimeSessionId: string, data: string): void {
  sendToRenderer("pty:data", runtimeSessionId, data);
}

function sendWorktreeDisplayChanged(update: WorktreeDisplayUpdate): void {
  sendToRenderer("worktree:displayChanged", update);
}

function sendSessionsStateChanged(): void {
  sendToRenderer("sessions:stateChanged");
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

async function refreshWorktreeWatcher(): Promise<void> {
  if (!worktreeWatcher) {
    return;
  }
  worktreeWatcher.setRepos(loadRepos().map((repo) => repo.repoPath));
}

function registerIpcHandlers(): void {
  ipcMain.handle("metadata:listRepos", () => service.getRepos());
  ipcMain.handle("providers:list", () => service.getSessionProviders());

  ipcMain.handle("pty:attach", (_event, runtimeSessionId: string) => {
    return service.attachPty(runtimeSessionId);
  });

  ipcMain.handle("pty:ready", (_event, runtimeSessionId: string) => {
    const pendingChunk = service.readyPty(runtimeSessionId);
    if (pendingChunk) {
      sendPtyData(runtimeSessionId, pendingChunk);
    }
  });

  ipcMain.handle("pty:detach", (_event, runtimeSessionId: string) => {
    service.detachPty(runtimeSessionId);
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

  ipcMain.handle(
    "session:createWorktree",
    (_event, provider: SessionProvider, repoPath: string, branchName: string) => {
      return service.createWorktreeSession(provider, repoPath, branchName);
    },
  );

  ipcMain.handle("worktree:remove", (_event, repoPath: string, worktreePath: string) => {
    return service.removeWorktree(repoPath, worktreePath);
  });

  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    return service.openExternal(url);
  });

  ipcMain.handle("git:pathStates", (_event, worktreeId: string) => {
    return service.getGitPathStates(worktreeId);
  });

  ipcMain.handle("git:branchContext", (_event, worktreeId: string) => {
    return service.getGitBranchContext(worktreeId);
  });

  ipcMain.handle("git:diffDocument", (_event, worktreeId: string, filePath: string) => {
    return service.getGitDiffDocument(worktreeId, filePath);
  });

  ipcMain.handle("files:list", (_event, worktreeId: string, relativePath?: string) => {
    return service.listFiles(worktreeId, relativePath);
  });

  ipcMain.handle("files:listAll", (_event, worktreeId: string) => {
    return service.listAllFiles(worktreeId);
  });

  ipcMain.handle("files:resolveRepoFile", (_event, worktreeId: string, filePath: string) => {
    return service.resolveRepoFile(worktreeId, filePath);
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

  ipcMain.on("pty:write", (_event, runtimeSessionId: string, data: string) => {
    service.ptyWrite(runtimeSessionId, data);
  });

  ipcMain.on("pty:resize", (_event, runtimeSessionId: string, cols: number, rows: number) => {
    service.ptyResize(runtimeSessionId, cols, rows);
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
  createWindow();

  worktreeWatcher = new WorktreeWatcher();
  worktreeWatcher.onChange(() => {
    void refreshWorktreeWatcher();
    sendSessionsStateChanged();
  });
  void refreshWorktreeWatcher();
  registerIpcHandlers();
});

app.on("window-all-closed", () => {
  worktreeWatcher?.stop();
  service.stop();
  app.quit();
});
