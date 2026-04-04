import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getSessions: () => ipcRenderer.invoke("sessions:list"),
  selectSession: (session: unknown) => ipcRenderer.send("session:select", session),
  createSession: (repoPath: string) => ipcRenderer.invoke("session:create", repoPath),
  createWorktreeSession: (repoPath: string, branchName: string) =>
    ipcRenderer.invoke("session:createWorktree", repoPath, branchName),
  removeWorktree: (repoPath: string, worktreePath: string) =>
    ipcRenderer.invoke("worktree:remove", repoPath, worktreePath),
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  getGitStatus: (sessionId: string) => ipcRenderer.invoke("git:status", sessionId),
  getGitDiff: (sessionId: string, filePath: string) =>
    ipcRenderer.invoke("git:diff", sessionId, filePath),
  onSessionEnded: (callback: (sessionId: string) => void) =>
    ipcRenderer.on("session:ended", (_event, sessionId) => callback(sessionId)),
  ptyWrite: (sessionId: string, data: string) => ipcRenderer.send("pty:write", sessionId, data),
  ptyResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", sessionId, cols, rows),
  onPtyData: (callback: (sessionId: string, data: string) => void) =>
    ipcRenderer.on("pty:data", (_event, sessionId, data) => callback(sessionId, data)),
});
