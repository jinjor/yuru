import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "path";
import crypto from "crypto";
import * as pty from "node-pty";
import { loadSessions, Session } from "./sessions.js";
import { getGitStatus, getGitDiff } from "./git.js";

let mainWindow: BrowserWindow | null = null;
const ptyProcesses = new Map<string, pty.IPty>();
const sessionCwdMap = new Map<string, string>();

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

function spawnClaude(sessionId: string, cwd: string, args: string[]): void {
  if (ptyProcesses.has(sessionId)) {
    return;
  }

  sessionCwdMap.set(sessionId, cwd);

  const proc = pty.spawn("claude", args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: process.env as Record<string, string>,
  });
  ptyProcesses.set(sessionId, proc);

  proc.onData((data: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pty:data", sessionId, data);
    }
  });

  proc.onExit(() => {
    ptyProcesses.delete(sessionId);
    sessionCwdMap.delete(sessionId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("session:ended", sessionId);
    }
  });
}

function killAllPty(): void {
  for (const proc of ptyProcesses.values()) {
    proc.kill();
  }
  ptyProcesses.clear();
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("sessions:list", () => {
    return loadSessions();
  });

  ipcMain.on("session:select", (_event, session: Session) => {
    if (session.state === "archived") {
      return;
    }
    sessionCwdMap.set(session.id, session.project);
    spawnClaude(session.id, session.project, ["--resume", session.id]);
  });

  ipcMain.handle("session:create", async (_event, repoPath: string) => {
    const tempId = `new-${crypto.randomUUID()}`;
    spawnClaude(tempId, repoPath, []);
    const session: Session = {
      id: tempId,
      project: repoPath,
      projectName: path.basename(repoPath),
      lastMessage: "",
      timestamp: Date.now(),
      state: "active",
    };
    return session;
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
  killAllPty();
  app.quit();
});
