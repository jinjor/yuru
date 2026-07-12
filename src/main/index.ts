import { app, BrowserWindow, Menu, ipcMain } from "electron";
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from "electron";
import path from "path";
import { loadRepos } from "./metadata.js";
import { cleanupStaleTaskWorktrees } from "./task-worktree-maintenance.js";
import { WorktreeWatcher } from "./worktree-watcher.js";
import { YuruService } from "./service.js";
import { APP_NAME, getWindowTitleForAppPath } from "./app-title.js";
import { recordAppError, recordAppWarning, setErrorNoticesListener } from "./error-center.js";
import { toAppError } from "./errors.js";
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
  refreshWorktreeWatcher,
  addWorktreeWatcherRepo,
});

setErrorNoticesListener(sendErrorNoticesChanged);

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

function sendErrorNoticesChanged(notices: AppErrorNotice[]): void {
  sendToRenderer("errors:changed", notices);
}

function addWorktreeWatcherRepo(repoPath: string): void {
  worktreeWatcher?.addRepo(repoPath);
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

  // 画面が急に消える・固まる系の後追い調査用。error center は main 側なので、
  // renderer が死んでもリロード後にエラーログから確認できる。
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    recordAppError({
      code: "unknown",
      message: "The screen process crashed.",
      detail: `reason: ${details.reason}, exitCode: ${details.exitCode}`,
    });
  });
  mainWindow.on("unresponsive", () => {
    recordAppError({
      code: "unknown",
      message: "The screen became unresponsive.",
    });
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

// service は失敗を Result で返すルールだが、ルール外の例外が投げられた場合も
// error center に記録してから投げ直し、エラーログで気づけるようにする。
function handleIpc<Args extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...(args as Args));
    } catch (error) {
      recordAppError(toAppError(error));
      throw error;
    }
  });
}

function registerIpcHandlers(): void {
  handleIpc("metadata:listRepos", () => service.getRepos());
  handleIpc("providers:list", () => service.getSessionProviders());

  handleIpc("pty:attach", (_event, terminalRuntimeId: string) => {
    return service.attachPty(terminalRuntimeId);
  });

  handleIpc("pty:ready", (_event, terminalRuntimeId: string) => {
    const pendingChunk = service.readyPty(terminalRuntimeId);
    if (pendingChunk) {
      sendPtyData(terminalRuntimeId, pendingChunk);
    }
  });

  handleIpc("pty:detach", (_event, terminalRuntimeId: string) => {
    service.detachPty(terminalRuntimeId);
  });

  handleIpc("errors:list", () => service.getErrors());

  handleIpc("errors:dismiss", (_event, id: string) => {
    service.dismissError(id);
  });

  handleIpc("errors:clear", () => {
    service.clearErrors();
  });

  ipcMain.on("errors:reportRenderer", (_event, message: string, detail?: string) => {
    recordAppError({ code: "unknown", message, detail });
  });

  handleIpc(
    "worktreeSession:resumePrimary",
    (_event, worktreeId: string, providerSessionKey: string) => {
      return service.resumePrimarySession(worktreeId, providerSessionKey);
    },
  );

  handleIpc(
    "worktreeSession:resumeSuggested",
    (_event, worktreeId: string, providerSessionKey: string) => {
      return service.resumeSuggestedSession(worktreeId, providerSessionKey);
    },
  );

  handleIpc("worktreeSession:create", (_event, worktreeId: string, provider: SessionProvider) => {
    return service.createSessionForWorktree(worktreeId, provider);
  });

  handleIpc("worktreeTerminal:open", (_event, worktreeId: string) => {
    return service.openWorktreeTerminal(worktreeId);
  });

  handleIpc(
    "session:createWorktree",
    (_event, provider: SessionProvider, repoPath: string, branchName: string) => {
      return service.createWorktreeSession(provider, repoPath, branchName);
    },
  );

  handleIpc("worktree:remove", (_event, worktreeId: string, force: boolean) => {
    return service.removeWorktree(worktreeId, force);
  });

  handleIpc("shell:openExternal", (_event, url: string) => {
    return service.openExternal(url);
  });

  handleIpc("git:pathStates", (_event, worktreeId: string) => {
    return service.getGitPathStates(worktreeId);
  });

  handleIpc(
    "git:diffDocument",
    (_event, worktreeId: string, filePath: string, scope?: GitDiffScope) => {
      return service.getGitDiffDocument(worktreeId, filePath, scope);
    },
  );

  handleIpc("files:list", (_event, worktreeId: string, relativePath?: string) => {
    return service.listFiles(worktreeId, relativePath);
  });

  handleIpc("files:listAll", (_event, worktreeId: string) => {
    return service.listAllFiles(worktreeId);
  });

  handleIpc("files:resolveRepoFile", (_event, worktreeId: string, filePath: string) => {
    return service.resolveRepoFile(worktreeId, filePath);
  });

  handleIpc("files:readWorktree", (_event, worktreeId: string, filePath: string) => {
    return service.readWorktreeFile(worktreeId, filePath);
  });

  handleIpc("files:write", (_event, worktreeId: string, filePath: string, content: string) => {
    return service.writeFile(worktreeId, filePath, content);
  });

  handleIpc("files:syncWatchTargets", (_event, worktreeId: string, relativePaths: string[]) => {
    return service.syncFileWatchTargets(worktreeId, relativePaths);
  });

  handleIpc("search:code", (_event, worktreeId: string, query: string) => {
    return service.searchCode(worktreeId, query);
  });

  handleIpc("search:cancelCode", (_event, worktreeId: string) => {
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
  if (!app.isPackaged) {
    // Dev runs launch the stock Electron.app bundle, so the packaged .icns
    // never applies; set the Dock icon at runtime instead.
    app.dock?.setIcon(path.join(app.getAppPath(), "assets", "icon.png"));
  }
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
  });
  const cleanupResult = await cleanupStaleTaskWorktrees();
  for (const skippedRepo of cleanupResult.skippedRepos) {
    const appError = toAppError(skippedRepo.error);
    recordAppWarning({
      ...appError,
      message: `Skipped stale task worktree cleanup for ${skippedRepo.repoPath}.`,
      detail: appError.message,
    });
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
