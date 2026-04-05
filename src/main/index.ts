import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "path";
import * as pty from "node-pty";
import { loadSessions, Session } from "./sessions.js";
import { getGitStatus, getGitDiff, removeWorktree, renameBranch, branchExists } from "./git.js";
import { SessionWatcher, ActiveSessionInfo } from "./session-watcher.js";
import { worktreeCwd, ccBranchName, pidFilePath } from "./claude-paths.js";
import fs from "fs";

let mainWindow: BrowserWindow | null = null;
const ptyProcesses = new Map<string, pty.IPty>();
const pendingProcesses = new Set<pty.IPty>();
const sessionCwdMap = new Map<string, string>();
let sessionWatcher: SessionWatcher | null = null;

interface PendingSession {
  proc: pty.IPty;
  sessionCwd: string;
  sessionId: string | null;
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

function launchClaude(cwd: string, args: string[], worktreeName?: string): PendingSession {
  const sessionCwd = worktreeName ? worktreeCwd(cwd, worktreeName) : cwd;
  const spawnArgs = [...args];
  if (worktreeName) {
    spawnArgs.push("--worktree", worktreeName);
  }
  const proc = pty.spawn("claude", spawnArgs, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: process.env as Record<string, string>,
  });
  pendingProcesses.add(proc);
  const pending: PendingSession = {
    proc,
    sessionCwd,
    sessionId: null,
    exited: false,
  };

  proc.onData((data: string) => {
    if (!pending.sessionId || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send("pty:data", pending.sessionId, data);
  });

  proc.onExit(() => {
    pending.exited = true;
    pendingProcesses.delete(proc);
    if (!pending.sessionId) {
      return;
    }
    ptyProcesses.delete(pending.sessionId);
    sessionCwdMap.delete(pending.sessionId);
  });

  return pending;
}

function registerSession(sessionId: string, pending: PendingSession): void {
  pending.sessionId = sessionId;
  pendingProcesses.delete(pending.proc);
  ptyProcesses.set(sessionId, pending.proc);
  sessionCwdMap.set(sessionId, pending.sessionCwd);
}

async function waitForSessionId(pending: PendingSession): Promise<string> {
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

app.whenReady().then(() => {
  createWindow();

  sessionWatcher = new SessionWatcher();
  sessionWatcher.onStateChange((activeSessions: ActiveSessionInfo[]) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send("sessions:stateChanged", activeSessions);
  });
  sessionWatcher.start();

  ipcMain.handle("sessions:list", () => {
    return loadSessions();
  });

  ipcMain.on("session:select", (_event, session: Session) => {
    if (session.state === "archived") {
      return;
    }
    if (ptyProcesses.has(session.id)) {
      return;
    }
    sessionCwdMap.set(session.id, session.project);
    const pending = launchClaude(session.project, ["--resume", session.id]);
    registerSession(session.id, pending);
  });

  ipcMain.handle("session:create", async (_event, repoPath: string) => {
    const pending = launchClaude(repoPath, []);
    try {
      const sessionId = await waitForSessionId(pending);
      registerSession(sessionId, pending);
      const session: Session = {
        id: sessionId,
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

  ipcMain.handle("session:createWorktree", async (_event, repoPath: string, branchName: string) => {
    const worktreeName = branchName.replace(/\//g, "-");
    const worktreePath = worktreeCwd(repoPath, worktreeName);

    // Pre-check: worktree directory and branch name must not already exist
    if (fs.existsSync(worktreePath)) {
      throw new Error(`Worktree "${worktreeName}" already exists`);
    }
    if (await branchExists(repoPath, branchName)) {
      throw new Error(`Branch "${branchName}" already exists`);
    }

    const pending = launchClaude(repoPath, [], worktreeName);
    try {
      const sessionId = await waitForSessionId(pending);
      registerSession(sessionId, pending);

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

      const session: Session = {
        id: sessionId,
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
      throw error;
    }
  });

  ipcMain.handle("worktree:remove", async (_event, repoPath: string, worktreePath: string) => {
    await removeWorktree(repoPath, worktreePath);
  });

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
    const cwd = sessionCwdMap.get(sessionId);
    if (!cwd) {
      return [];
    }
    try {
      return await getGitStatus(cwd);
    } catch {
      return [];
    }
  });

  ipcMain.handle("git:diff", async (_event, sessionId: string, filePath: string) => {
    const cwd = sessionCwdMap.get(sessionId);
    if (!cwd) {
      return "";
    }
    try {
      return await getGitDiff(cwd, filePath);
    } catch {
      return "";
    }
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
  if (sessionWatcher) {
    sessionWatcher.stop();
  }
  killAllPty();
  app.quit();
});
