import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "path";
import * as pty from "node-pty";
import { findCodexSessionForLaunch, listCodexSessionIds, loadSessions } from "./sessions.js";
import {
  createWorktree,
  getGitStatus,
  getGitDiffDocument,
  getCurrentBranch,
  removeWorktree,
  renameBranch,
  branchExists,
} from "./git.js";
import { listFiles, readFileContent, fileExists } from "./files.js";
import { worktreeCwd as claudeWorktreeCwd, ccBranchName, pidFilePath } from "./claude-paths.js";
import { yuruWorktreeCwd } from "./worktree-paths.js";
import { WorktreeWatcher } from "./worktree-watcher.js";
import fs from "fs";
import { Session, SessionProvider, toSessionKey } from "../shared/session.js";

let mainWindow: BrowserWindow | null = null;
const ptyProcesses = new Map<string, pty.IPty>();
const pendingProcesses = new Set<pty.IPty>();
const sessionRuntimeMap = new Map<string, { cwd: string; provider: SessionProvider }>();
let worktreeWatcher: WorktreeWatcher | null = null;

interface PendingSession {
  proc: pty.IPty;
  provider: SessionProvider;
  sessionCwd: string;
  providerSessionId: string | null;
  appSessionId: string | null;
  startedAt: number;
  existingProviderSessionIds: ReadonlySet<string>;
  exited: boolean;
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

function launchSession(
  provider: SessionProvider,
  cwd: string,
  args: string[],
  sessionCwd: string,
  existingProviderSessionIds: ReadonlySet<string> = new Set(),
): PendingSession {
  const command = provider === "claude" ? "claude" : "codex";
  const proc = pty.spawn(command, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: process.env as Record<string, string>,
  });
  pendingProcesses.add(proc);
  const pending: PendingSession = {
    proc,
    provider,
    sessionCwd,
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

function launchClaude(cwd: string, args: string[], worktreeName?: string): PendingSession {
  const sessionCwd = worktreeName ? claudeWorktreeCwd(cwd, worktreeName) : cwd;
  const spawnArgs = [...args];
  if (worktreeName) {
    spawnArgs.push("--worktree", worktreeName);
  }
  return launchSession("claude", cwd, spawnArgs, sessionCwd);
}

function launchCodex(
  cwd: string,
  args: string[],
  existingProviderSessionIds: ReadonlySet<string> = new Set(),
): PendingSession {
  return launchSession("codex", cwd, args, cwd, existingProviderSessionIds);
}

function registerSession(appSessionId: string, providerSessionId: string, pending: PendingSession): void {
  pending.providerSessionId = providerSessionId;
  pending.appSessionId = appSessionId;
  pendingProcesses.delete(pending.proc);
  ptyProcesses.set(appSessionId, pending.proc);
  sessionRuntimeMap.set(appSessionId, { cwd: pending.sessionCwd, provider: pending.provider });
}

async function waitForClaudeSessionId(pending: PendingSession): Promise<string> {
  const sessionFile = pidFilePath(pending.proc.pid);
  for (let attempt = 0; attempt < 150; attempt++) {
    if (fs.existsSync(sessionFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
        if (typeof data.sessionId === "string" && data.sessionId) {
          return data.sessionId;
        }
      } catch {
        // Ignore partial writes while Claude is still initializing the session file.
      }
    }
    if (pending.exited) {
      throw new Error("Claude exited before creating a session");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timeout waiting for Claude session initialization");
}

async function waitForCodexSessionId(pending: PendingSession): Promise<string> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const launched = await findCodexSessionForLaunch(
      pending.sessionCwd,
      pending.startedAt,
      pending.existingProviderSessionIds,
    );
    if (launched) {
      return launched.providerSessionId;
    }
    if (pending.exited) {
      throw new Error("Codex exited before creating a session");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timeout waiting for Codex session initialization");
}

async function waitForSessionId(pending: PendingSession): Promise<string> {
  return pending.provider === "claude"
    ? waitForClaudeSessionId(pending)
    : waitForCodexSessionId(pending);
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
  const activeSessions = Array.from(sessionRuntimeMap, ([sessionId, info]) => ({
    sessionId,
    cwd: info.cwd,
  }));
  mainWindow.webContents.send("sessions:stateChanged", activeSessions);
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

  ipcMain.on("session:select", (_event, session: Session) => {
    if (session.state === "archived") {
      return;
    }
    if (ptyProcesses.has(session.id)) {
      return;
    }
    const pending =
      session.provider === "claude"
        ? launchClaude(session.project, ["--resume", session.providerSessionId])
        : launchCodex(session.project, ["resume", session.providerSessionId]);
    registerSession(session.id, session.providerSessionId, pending);
    emitSessionsStateChanged();
  });

  ipcMain.handle("session:create", async (_event, provider: SessionProvider, repoPath: string) => {
    const pending =
      provider === "claude"
        ? launchClaude(repoPath, [])
        : launchCodex(repoPath, [], await listCodexSessionIds());
    try {
      const providerSessionId = await waitForSessionId(pending);
      const sessionId = toSessionKey(provider, providerSessionId);
      registerSession(sessionId, providerSessionId, pending);
      await refreshWorktreeWatcher();
      const session: Session = {
        id: sessionId,
        provider,
        providerSessionId,
        project: repoPath,
        projectName: path.basename(repoPath),
        repoPath,
        lastMessage: "",
        timestamp: Date.now(),
        state: "active",
      };
      return session;
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
    const worktreeName = branchName.replace(/\//g, "-");
    const worktreePath =
      provider === "claude" ? claudeWorktreeCwd(repoPath, worktreeName) : yuruWorktreeCwd(repoPath, worktreeName);

    // Pre-check: worktree directory and branch name must not already exist
    if (fs.existsSync(worktreePath)) {
      throw new Error(`Worktree "${worktreeName}" already exists`);
    }
    if (await branchExists(repoPath, branchName)) {
      throw new Error(`Branch "${branchName}" already exists`);
    }

    if (provider === "codex") {
      await createWorktree(repoPath, worktreePath, branchName);
    }

    const pending =
      provider === "claude"
        ? launchClaude(repoPath, [], worktreeName)
        : launchCodex(worktreePath, [], await listCodexSessionIds());
    try {
      const providerSessionId = await waitForSessionId(pending);
      const sessionId = toSessionKey(provider, providerSessionId);
      registerSession(sessionId, providerSessionId, pending);

      if (provider === "claude") {
        // Wait for CC to create the worktree, then rename the branch
        const ccBranch = ccBranchName(worktreeName);
        if (branchName !== ccBranch) {
          const waitForBranch = (): Promise<void> => {
            return new Promise((resolve, reject) => {
              let attempts = 0;
              const check = async (): Promise<void> => {
                if (await branchExists(repoPath, ccBranch)) {
                  resolve();
                } else if (attempts++ > 150) {
                  reject(new Error("Timeout waiting for branch creation"));
                } else {
                  setTimeout(check, 200);
                }
              };
              check();
            });
          };
          await waitForBranch();
          await renameBranch(worktreePath, ccBranch, branchName);
        }
      }

      await refreshWorktreeWatcher();

      const session: Session = {
        id: sessionId,
        provider,
        providerSessionId,
        project: worktreePath,
        projectName: worktreeName,
        repoPath,
        lastMessage: "",
        timestamp: Date.now(),
        state: "active",
        worktree: {
          name: worktreeName,
          branch: branchName,
        },
      };
      return session;
    } catch (error) {
      if (!pending.exited) {
        pending.proc.kill();
      }
      if (provider === "codex" && fs.existsSync(worktreePath)) {
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

  ipcMain.handle("git:branch", async (_event, sessionId: string) => {
    const runtime = sessionRuntimeMap.get(sessionId);
    if (!runtime) {
      return null;
    }
    return getCurrentBranch(runtime.cwd);
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
