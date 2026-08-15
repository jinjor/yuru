import { app, BrowserWindow, Menu, ipcMain, protocol, session } from "electron";
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from "electron";
import path from "path";
import { loadRepos } from "./repos/metadata.js";
import { cleanupStaleTaskWorktrees } from "./repos/maintenance.js";
import { WorktreeWatcher } from "./repos/watcher.js";
import { YuruService } from "./service.js";
import { APP_NAME, getWindowTitleForAppPath } from "./app-title.js";
import { recordAppError, recordAppWarning, setErrorNoticesListener } from "./errors/center.js";
import { toAppError } from "./errors/app-error.js";
import { fetchGitHubPullRequests } from "./github/github.js";
import { listWorktrees } from "./git/worktree.js";
import { PullRequestMonitor } from "./github/pull-request-monitor.js";
import { PlanUsageMonitor } from "./agents/plan-usage-monitor.js";
import { RateLimitRecovery } from "./agents/rate-limit-recovery.js";
import { resolveCommandPaths } from "./agents/command.js";
import { getAgent, agents } from "./agents/registry.js";
import type {
  AppErrorNotice,
  GitDiffScope,
  PullRequestUpdate,
  SessionUpdate,
  WorktreeProcessRef,
} from "../shared/ipc.js";
import type { ProviderPlanUsage, SessionProvider } from "../shared/session.js";
import {
  HTML_PREVIEW_CSP,
  HTML_PREVIEW_SCHEME,
  HtmlPreviewGrants,
} from "./preview/html-preview.js";
import {
  createApiRequestHandler,
  getApiSocketPath,
  startApiServer,
  type ApiServer,
} from "./api/server.js";
import { materializeYuruSkill } from "./api/skill-materializer.js";

let mainWindow: BrowserWindow | null = null;
let worktreeWatcher: WorktreeWatcher | null = null;
let apiServer: ApiServer | null = null;
let servicesStopped = false;

const HIDE_WINDOW_FOR_E2E = process.env.YURU_E2E_HIDE_WINDOW === "1";
const apiSocketPath = getApiSocketPath();
const yuruCliPath = path.join(app.getAppPath(), "scripts", "yuru-cli", "index.mjs");
const yuruSkillSourcePath = path.join(app.getAppPath(), "skills", "yuru", "SKILL.md");

app.setName(APP_NAME);

protocol.registerSchemesAsPrivileged([
  {
    scheme: HTML_PREVIEW_SCHEME,
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
]);

const htmlPreviewGrants = new HtmlPreviewGrants();

const service = new YuruService(
  {
    fileTreeChanged: sendFileTreeChanged,
    ptyData: sendPtyData,
    terminalRuntimeExited: sendTerminalRuntimeExited,
    sessionChanged: sendSessionChanged,
    repoListChanged: sendRepoListChanged,
    refreshWorktreeWatcher,
    addWorktreeWatcherRepo,
  },
  {
    apiSocketPath,
    yuruCliPath,
  },
);

setErrorNoticesListener(sendErrorNoticesChanged);

// PR バッジの鮮度はこのポーリングが担う。ウィンドウのフォーカスに合わせて
// 起動・停止するので、誰も見ていない間は GitHub へのリクエストが発生しない。
const pullRequestMonitor = new PullRequestMonitor({
  listRepos: loadRepos,
  listWorktrees,
  fetchPullRequests: fetchGitHubPullRequests,
  hasAliveTerminalRuntimeInRepo: (repoPath) => service.hasAliveTerminalRuntimeInRepo(repoPath),
  pullRequestsChanged: sendPullRequestsChanged,
});

// プランの利用状況のポーリング。PR と同じくフォーカス中だけ動く。この結果が
// 「どの provider を出すか」も決めるので、起動直後にも 1 回走らせる。
const planUsageMonitor = new PlanUsageMonitor({
  listProviders: () =>
    Object.values(agents).map((agent) => ({
      provider: agent.definition.id,
      command: agent.command,
    })),
  resolveCommandPaths: (commands) => resolveCommandPaths(commands),
  loadPlanUsage: (provider, commandPath) => getAgent(provider).loadPlanUsage(commandPath),
  planUsageChanged: sendProviderPlanUsageChanged,
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

function sendPullRequestsChanged(updates: PullRequestUpdate[]): void {
  sendToRenderer("pullRequests:changed", updates);
}

// renderer は push で受け取るが、購読を始める前に最初の tick が終わることも、
// 再読み込みで購読し直すこともある。取りこぼすと provider の一覧ごと空になり
// セッションを開始できなくなるので、最後の結果を持っておいて初期表示に配る。
let latestPlanUsages: ProviderPlanUsage[] = [];

// rate limit の解消を、プラン利用状況の更新のたびに見る。解消していれば
// その provider のセッションを続きから動かす (F58)。
const rateLimitRecovery = new RateLimitRecovery({
  refreshPlanUsage: () => {
    void planUsageMonitor.refreshOnce();
  },
  resumeSessions: (provider) => {
    void service.resumeAfterRateLimit(provider);
  },
});

function sendProviderPlanUsageChanged(usages: ProviderPlanUsage[]): void {
  latestPlanUsages = usages;
  rateLimitRecovery.update(usages);
  sendToRenderer("providerPlanUsage:changed", usages);
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
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        ...(isDev
          ? ([
              { type: "separator" },
              { role: "toggleDevTools" },
            ] satisfies MenuItemConstructorOptions[])
          : []),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  const windowTitle = await getWindowTitleForAppPath(app.getAppPath());
  mainWindow = new BrowserWindow({
    title: windowTitle,
    width: 1525,
    height: 900,
    show: !HIDE_WINDOW_FOR_E2E,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // renderer 内（ライブラリ内部を含む）の window.open で Electron の子ウインドウを
  // 開かせず、既定ブラウザに流す。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    service.openExternal(url).catch((error: unknown) => {
      recordAppError(toAppError(error));
    });
    return { action: "deny" };
  });

  // アプリ本体は画面遷移しない。preview iframe も専用 protocol 内だけに閉じ込める。
  mainWindow.webContents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame || !isHtmlPreviewUrl(event.url)) {
      event.preventDefault();
    }
  });

  // 画面を読み込み直すと、それまでの grant を release する側 (renderer) がいなくなる。
  mainWindow.webContents.on("did-navigate", () => {
    htmlPreviewGrants.clear();
  });

  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow?.setTitle(windowTitle);
  });

  // 画面が急に消える・固まる系の後追い調査用。error center は main 側なので、
  // renderer が死んでもリロード後にエラーログから確認できる。
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    htmlPreviewGrants.clear();
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

function isHtmlPreviewUrl(url: string): boolean {
  try {
    return new URL(url).protocol === `${HTML_PREVIEW_SCHEME}:`;
  } catch {
    return false;
  }
}

function isMainFrameSender(event: IpcMainInvokeEvent): boolean {
  return (
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  );
}

function registerHtmlPreviewProtocol(): void {
  protocol.handle(HTML_PREVIEW_SCHEME, async (request) => {
    try {
      const response = await htmlPreviewGrants.respond(request.url, request.method);
      return new Response(new Uint8Array(response.body), {
        headers: response.headers,
        status: response.status,
      });
    } catch (error) {
      recordAppError(toAppError(error));
      return new Response("HTML preview failed", {
        headers: {
          "Content-Security-Policy": HTML_PREVIEW_CSP,
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
        status: 500,
      });
    }
  });
}

function configureBrowserPermissions(): void {
  // Yuru 本体は browser permission API を使わない。preview の HTML が権限を要求しても
  // prompt を出したり暗黙に許可したりしない。
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
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
  pullRequestMonitor.stop();
  planUsageMonitor.stop();
  rateLimitRecovery.stop();
  worktreeWatcher?.stop();
  try {
    await apiServer?.stop();
  } finally {
    apiServer = null;
    await service.stop();
  }
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

  handleIpc("providerPlanUsage:list", () => latestPlanUsages);
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
    (_event, worktreeId: string, agentSessionKey: string) => {
      return service.resumePrimarySession(worktreeId, agentSessionKey);
    },
  );

  handleIpc(
    "worktreeSession:resumeSuggested",
    (_event, worktreeId: string, agentSessionKey: string) => {
      return service.resumeSuggestedSession(worktreeId, agentSessionKey);
    },
  );

  handleIpc(
    "worktreeSession:detachPrimary",
    (_event, worktreeId: string, agentSessionKey: string) => {
      return service.detachPrimarySession(worktreeId, agentSessionKey);
    },
  );

  handleIpc("worktreeSession:create", (_event, worktreeId: string, provider: SessionProvider) => {
    return service.createSessionForWorktree(worktreeId, provider);
  });

  handleIpc("worktreeTerminal:open", (_event, worktreeId: string) => {
    return service.openWorktreeTerminal(worktreeId);
  });

  handleIpc("terminalRuntime:kill", (_event, terminalRuntimeId: string) => {
    return service.killTerminalRuntime(terminalRuntimeId);
  });

  handleIpc("worktree:create", (_event, repoPath: string, branchName: string) => {
    return service.createTaskWorktree(repoPath, branchName);
  });

  handleIpc("worktree:createFromRemoteBranch", (_event, repoPath: string, branchName: string) => {
    return service.createTaskWorktreeFromRemoteBranch(repoPath, branchName);
  });

  handleIpc(
    "worktree:prepareRemoval",
    (_event, worktreeId: string, force: boolean, processesToStop?: WorktreeProcessRef[]) => {
      return service.prepareWorktreeRemoval(worktreeId, force, processesToStop);
    },
  );
  handleIpc("worktree:executeRemoval", (_event, worktreeId: string, force: boolean) => {
    return service.executeWorktreeRemoval(worktreeId, force);
  });

  handleIpc("shell:openExternal", (_event, url: string) => {
    return service.openExternal(url);
  });

  handleIpc("git:pathStates", (_event, worktreeId: string) => {
    return service.getGitPathStates(worktreeId);
  });

  handleIpc("git:reviewState", (_event, worktreeId: string) => {
    return service.getReviewState(worktreeId);
  });

  handleIpc(
    "git:setFileReviewed",
    (
      _event,
      worktreeId: string,
      filePath: string,
      scope: GitDiffScope | undefined,
      reviewed: boolean,
    ) => {
      return service.setFileReviewed(worktreeId, filePath, scope, reviewed);
    },
  );

  handleIpc(
    "git:diffDocument",
    (_event, worktreeId: string, filePath: string, scope?: GitDiffScope) => {
      return service.getGitDiffDocument(worktreeId, filePath, scope);
    },
  );

  handleIpc(
    "git:imageDiffDocument",
    (_event, worktreeId: string, filePath: string, scope?: GitDiffScope) => {
      return service.getImageDiffDocument(worktreeId, filePath, scope);
    },
  );

  handleIpc(
    "htmlPreview:create",
    async (event, worktreeId: string, filePath: string, content: string) => {
      if (!isMainFrameSender(event)) {
        throw new Error("HTML preview grants are only available to the main frame.");
      }
      const target = await service.resolveHtmlPreviewEntry(worktreeId, filePath);
      if (!target.ok) {
        return target;
      }
      const grant = await htmlPreviewGrants.create(target.data.root, target.data.path, content);
      return { ok: true, data: grant } as const;
    },
  );

  handleIpc("htmlPreview:release", (event, grantId: string) => {
    if (!isMainFrameSender(event)) {
      throw new Error("HTML preview grants are only available to the main frame.");
    }
    htmlPreviewGrants.release(grantId);
  });

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
  registerHtmlPreviewProtocol();
  configureBrowserPermissions();
  try {
    await materializeYuruSkill({ sourceSkillPath: yuruSkillSourcePath });
  } catch (error) {
    const appError = toAppError(error);
    recordAppWarning({
      ...appError,
      message: "Yuru skill could not be installed.",
      detail: appError.message,
    });
  }
  const cleanupResult = await cleanupStaleTaskWorktrees();
  for (const skippedRepo of cleanupResult.skippedRepos) {
    const appError = toAppError(skippedRepo.error);
    recordAppWarning({
      ...appError,
      message: `Skipped stale task worktree cleanup for ${skippedRepo.repoPath}.`,
      detail: appError.message,
    });
  }
  try {
    apiServer = await startApiServer({
      socketPath: apiSocketPath,
      handleRequest: createApiRequestHandler(service),
      onError: recordAppError,
    });
  } catch (error) {
    const appError = toAppError(error);
    recordAppWarning({
      ...appError,
      message: "Yuru API could not start.",
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

  app.on("browser-window-focus", () => {
    pullRequestMonitor.start();
    planUsageMonitor.start();
  });
  app.on("browser-window-blur", () => {
    pullRequestMonitor.stop();
    planUsageMonitor.stop();
  });
  // 起動時にすでにフォーカスされていると focus イベントが来ないことがあるため。
  if (mainWindow?.isFocused()) {
    pullRequestMonitor.start();
    planUsageMonitor.start();
  } else {
    // 非フォーカスで起動した場合、blur イベントは来ないので start() すると
    // 定期取得が止まらなくなる。provider の一覧は必要なので 1 回だけ取る。
    void planUsageMonitor.refreshOnce();
  }
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
