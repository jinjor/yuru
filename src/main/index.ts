import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import * as pty from "node-pty";
import { loadSessions, Session } from "./sessions.js";

let mainWindow: BrowserWindow | null = null;
let ptyProcess: pty.IPty | null = null;
let currentSessionId: string | null = null;

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

function killPty(): void {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }
  currentSessionId = null;
}

function spawnClaude(session: Session): void {
  killPty();

  const cwd = session.project;
  ptyProcess = pty.spawn("claude", ["--resume", session.id], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: process.env as Record<string, string>,
  });
  currentSessionId = session.id;

  ptyProcess.onData((data: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pty:data", data);
    }
  });

  ptyProcess.onExit(() => {
    if (currentSessionId === session.id) {
      ptyProcess = null;
      currentSessionId = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("session:ended", session.id);
      }
    }
  });
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

  ipcMain.on("pty:write", (_event, data: string) => {
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  ipcMain.on("pty:resize", (_event, cols: number, rows: number) => {
    if (ptyProcess) {
      ptyProcess.resize(cols, rows);
    }
  });
});

app.on("window-all-closed", () => {
  killPty();
  app.quit();
});
