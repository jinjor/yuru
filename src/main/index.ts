import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "path";
import * as pty from "node-pty";
import { loadSessions } from "./sessions.js";
import {
  getGitStatus,
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
import fs from "fs";
import { ActiveSessionState, BranchContext } from "../shared/ipc.js";
import {
  isResumableSession,
  Session,
  SessionProvider,
  toRuntimeSessionKey,
  toSessionKey,
} from "../shared/session.js";

let mainWindow: BrowserWindow | null = null;
const ptyProcesses = new Map<string, pty.IPty>();
const pendingProcesses = new Set<pty.IPty>();
const sessionRuntimeMap = new Map<string, RuntimeSessionInfo>();
let worktreeWatcher: WorktreeWatcher | null = null;

interface StartedSession {
  sessionId: string;
  providerSessionId: string | null;
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
): PendingSession {
  const existingProviderSessionIds = request.existingProviderSessionIds ?? new Set<string>();
  const proc = pty.spawn(providerAdapter.command, request.args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: request.cwd,
    env: process.env as Record<string, string>,
  });
  pendingProcesses.add(proc);
  const pending: PendingSession = {
    proc,
    provider: providerAdapter.definition.id,
    sessionCwd: request.sessionCwd,
    providerSessionId: null,
    appSessionId: null,
    startedAt: Date.now(),
    existingProviderSessionIds,
    exited: false,
  };

  proc.onData((data: string) => {
    if (!pending.appSessionId || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send("pty:data", pending.appSessionId, data);
  });

  proc.onExit(() => {
    pending.exited = true;
    pendingProcesses.delete(proc);
    if (!pending.appSessionId) {
      return;
    }
    ptyProcesses.delete(pending.appSessionId);
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
  pendingProcesses.clear();
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

  ipcMain.on("session:select", async (_event, session: Session) => {
    if (session.state === "archived") {
      return;
    }
    if (!isResumableSession(session)) {
      return;
    }
    if (ptyProcesses.has(session.id)) {
      return;
    }
    const providerAdapter = getSessionProvider(session.provider);
    const pending = launchPendingSession(providerAdapter, await providerAdapter.createResumeLaunch(session));
    registerSession(session.id, pending, session.providerSessionId);
    emitSessionsStateChanged();
  });

  ipcMain.handle("session:create", async (_event, provider: SessionProvider, repoPath: string) => {
    const providerAdapter = getSessionProvider(provider);
    const pending = launchPendingSession(providerAdapter, await providerAdapter.createNewLaunch(repoPath));
    try {
      const { sessionId, providerSessionId } = await startSession(provider, providerAdapter, pending);
      if (providerSessionId) {
        await refreshWorktreeWatcher();
      }
      return buildActiveSession({
        sessionId,
        provider,
        providerSessionId,
        project: repoPath,
        repoPath,
      });
    } catch (error) {
      if (!pending.exited) {
        pending.proc.kill();
      }
      throw error;
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
        throw new Error(`Worktree "${worktreeName}" already exists`);
      }
      if (await branchExists(repoPath, branchName)) {
        throw new Error(`Branch "${branchName}" already exists`);
      }

      await providerAdapter.prepareWorktree(worktreeContext);

      const pending = launchPendingSession(
        providerAdapter,
        await providerAdapter.createWorktreeLaunch(worktreeContext),
      );
      try {
        const { sessionId, providerSessionId } = await startSession(provider, providerAdapter, pending);
        await providerAdapter.finalizeWorktree(worktreeContext);
        await refreshWorktreeWatcher();
        return buildActiveSession({
          sessionId,
          provider,
          providerSessionId,
          project: worktreePath,
          repoPath,
          worktree: {
            name: worktreeName,
            branch: branchName,
          },
        });
      } catch (error) {
        if (!pending.exited) {
          pending.proc.kill();
        }
        if (fs.existsSync(worktreePath)) {
          await removeWorktree(repoPath, worktreePath).catch(() => undefined);
        }
        throw error;
      }
    },
  );

  ipcMain.handle(
    "worktree:remove",
    async (_event, _provider: SessionProvider, repoPath: string, worktreePath: string) => {
      await removeWorktree(repoPath, worktreePath);
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

  ipcMain.handle("git:status", async (_event, sessionId: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      return [];
    }
    try {
      return await getGitStatus(runtime.cwd);
    } catch {
      return [];
    }
  });

  ipcMain.handle("git:branchContext", async (_event, sessionId: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      return { branch: null, github: null } satisfies BranchContext;
    }

    const branch = await getCurrentBranch(runtime.cwd);
    if (!branch) {
      return { branch: null, github: null } satisfies BranchContext;
    }

    const repoPath =
      (await getRepoRootForProject(runtime.cwd)) ??
      getSessionProvider(runtime.provider).repoPathFromProject(runtime.cwd);
    const github = await getGitHubPullRequestForBranch(repoPath, branch);
    return { branch, github } satisfies BranchContext;
  });

  ipcMain.handle("git:diffDocument", async (_event, sessionId: string, filePath: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      return null;
    }
    try {
      return await getGitDiffDocument(runtime.cwd, filePath);
    } catch {
      return null;
    }
  });

  ipcMain.handle("files:list", async (_event, sessionId: string, relativePath?: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      return [];
    }
    try {
      return await listFiles(runtime.cwd, relativePath ?? "");
    } catch {
      return [];
    }
  });

  ipcMain.handle("files:read", async (_event, sessionId: string, filePath: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      return null;
    }
    try {
      return await readFileContent(runtime.cwd, filePath);
    } catch {
      return null;
    }
  });

  ipcMain.handle("files:exists", (_event, sessionId: string, filePath: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      return false;
    }
    return fileExists(runtime.cwd, filePath);
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
  killAllPty();
  app.quit();
});
