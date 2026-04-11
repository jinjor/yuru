import { contextBridge, ipcRenderer } from "electron";
import { ElectronAPI } from "../shared/ipc.js";
import { Session, SessionProvider } from "../shared/session.js";

const electronAPI: ElectronAPI = {
  getSessions: () => ipcRenderer.invoke("sessions:list"),
  getSessionProviders: () => ipcRenderer.invoke("providers:list"),
  selectSession: (session: Session) => ipcRenderer.send("session:select", session),
  createSession: (provider: SessionProvider, repoPath: string) =>
    ipcRenderer.invoke("session:create", provider, repoPath),
  createWorktreeSession: (provider: SessionProvider, repoPath: string, branchName: string) =>
    ipcRenderer.invoke("session:createWorktree", provider, repoPath, branchName),
  removeWorktree: (provider: SessionProvider, repoPath: string, worktreePath: string) =>
    ipcRenderer.invoke("worktree:remove", provider, repoPath, worktreePath),
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  getGitStatus: (sessionId: string) => ipcRenderer.invoke("git:status", sessionId),
  getGitBranchContext: (sessionId: string) => ipcRenderer.invoke("git:branchContext", sessionId),
  getGitDiffDocument: (sessionId: string, filePath: string) =>
    ipcRenderer.invoke("git:diffDocument", sessionId, filePath),
  listFiles: (sessionId: string, relativePath?: string) =>
    ipcRenderer.invoke("files:list", sessionId, relativePath),
  readFile: (sessionId: string, filePath: string) =>
    ipcRenderer.invoke("files:read", sessionId, filePath),
  fileExists: (sessionId: string, filePath: string) => ipcRenderer.invoke("files:exists", sessionId, filePath),
  onSessionsStateChanged: (callback) =>
    ipcRenderer.on("sessions:stateChanged", (_event, active) => callback(active)),
  ptyWrite: (sessionId: string, data: string) => ipcRenderer.send("pty:write", sessionId, data),
  ptyResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", sessionId, cols, rows),
  onPtyData: (callback) =>
    ipcRenderer.on("pty:data", (_event, sessionId, data) => callback(sessionId, data)),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
