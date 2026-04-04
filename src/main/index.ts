import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "path";
import crypto from "crypto";
import * as pty from "node-pty";
import { loadSessions, Session } from "./sessions.js";
import { getGitStatus, getGitDiff, removeWorktree, renameBranch, branchExists } from "./git.js";
import fs from "fs";

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

function spawnClaude(sessionId: string, cwd: string, args: string[], worktreeName?: string): void {
  if (ptyProcesses.has(sessionId)) {
    return;
  }

  if (worktreeName) {
    args.push("--worktree", worktreeName);
    sessionCwdMap.set(sessionId, path.join(cwd, ".claude", "worktrees", worktreeName));
  } else {
    sessionCwdMap.set(sessionId, cwd);
  }

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

  ipcMain.handle("session:createWorktree", async (_event, repoPath: string, branchName: string) => {
    const worktreeName = branchName.replace(/\//g, "-");
    const worktreePath = path.join(repoPath, ".claude", "worktrees", worktreeName);

    // Pre-check: worktree directory and branch name must not already exist
    if (fs.existsSync(worktreePath)) {
      throw new Error(`Worktree "${worktreeName}" already exists`);
    }
    if (await branchExists(repoPath, branchName)) {
      throw new Error(`Branch "${branchName}" already exists`);
    }

    const tempId = `new-${crypto.randomUUID()}`;
    spawnClaude(tempId, repoPath, [], worktreeName);

    // Wait for CC to create the worktree, then rename the branch
    const ccBranch = `worktree-${worktreeName}`;
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
      id: tempId,
      project: worktreePath,
      projectName: worktreeName,
      lastMessage: "",
      timestamp: Date.now(),
      state: "active",
      worktree: {
        name: worktreeName,
        branch: branchName,
      },
    };
    return session;
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
  killAllPty();
  app.quit();
});
