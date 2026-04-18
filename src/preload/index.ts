import { contextBridge, ipcRenderer } from "electron";
import { ElectronAPI } from "../shared/ipc.js";
import { Session, SessionProvider } from "../shared/session.js";

const electronAPI: ElectronAPI = {
  getSessions: () => ipcRenderer.invoke("sessions:list"),
  getSessionProviders: () => ipcRenderer.invoke("providers:list"),
  getErrors: () => ipcRenderer.invoke("errors:list"),
  dismissError: (id: string) => ipcRenderer.invoke("errors:dismiss", id),
  clearErrors: () => ipcRenderer.invoke("errors:clear"),
  selectSession: (session: Session) => ipcRenderer.invoke("session:select", session),
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
  onErrorAdded: (callback) =>
    ipcRenderer.on("errors:added", (_event, error) => callback(error)),
  onErrorRemoved: (callback) =>
    ipcRenderer.on("errors:removed", (_event, id) => callback(id)),
  onErrorsCleared: (callback) =>
    ipcRenderer.on("errors:cleared", () => callback()),
  onSessionsStateChanged: (callback) =>
    ipcRenderer.on("sessions:stateChanged", (_event, active) => callback(active)),
  attachPty: (sessionId: string) => ipcRenderer.invoke("pty:attach", sessionId),
  readyPty: (sessionId: string) => ipcRenderer.invoke("pty:ready", sessionId),
  detachPty: (sessionId: string) => ipcRenderer.invoke("pty:detach", sessionId),
  ptyWrite: (sessionId: string, data: string) => ipcRenderer.send("pty:write", sessionId, data),
  ptyResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", sessionId, cols, rows),
  onPtyData: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, sessionId: string, data: string) =>
      callback(sessionId, data);
    ipcRenderer.on("pty:data", listener);
    return () => {
      ipcRenderer.removeListener("pty:data", listener);
    };
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
