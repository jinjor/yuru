import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import os from "os";
import * as pty from "node-pty";

let mainWindow: BrowserWindow | null = null;
let ptyProcess: pty.IPty | null = null;

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

  mainWindow.webContents.on("did-finish-load", () => {
    spawnPty();
  });
}

function spawnPty(): void {
  const shell =
    os.platform() === "win32"
      ? "powershell.exe"
      : process.env.SHELL || "/bin/zsh";

  ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  });

  ptyProcess.onData((data: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pty:data", data);
    }
  });
}

app.whenReady().then(() => {
  createWindow();

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
  if (ptyProcess) {
    ptyProcess.kill();
  }
  app.quit();
});
