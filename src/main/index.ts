import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import * as pty from "node-pty";
import { loadSessions, Session } from "./sessions.js";

let mainWindow: BrowserWindow | null = null;
const ptyProcesses = new Map<string, pty.IPty>();

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

function spawnClaude(session: Session): void {
  // Already running — just switch to it
  if (ptyProcesses.has(session.id)) {
    return;
  }

  const cwd = session.project;
  const proc = pty.spawn("claude", ["--resume", session.id], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: process.env as Record<string, string>,
  });
  ptyProcesses.set(session.id, proc);

  proc.onData((data: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pty:data", session.id, data);
    }
  });

  proc.onExit(() => {
    ptyProcesses.delete(session.id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("session:ended", session.id);
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
    spawnClaude(session);
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
