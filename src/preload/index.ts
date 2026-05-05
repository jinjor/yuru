import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "../shared/ipc.js";
import type { SessionProvider } from "../shared/session.js";

const electronAPI: ElectronAPI = {
  getSessions: () => ipcRenderer.invoke("sessions:list"),
  getRepos: () => ipcRenderer.invoke("metadata:listRepos"),
  getSessionProviders: () => ipcRenderer.invoke("providers:list"),
  getErrors: () => ipcRenderer.invoke("errors:list"),
  dismissError: (id: string) => ipcRenderer.invoke("errors:dismiss", id),
  clearErrors: () => ipcRenderer.invoke("errors:clear"),
  selectWorktreeSession: (taskWorktreeId: string, providerSessionKey: string) =>
    ipcRenderer.invoke("worktreeSession:select", taskWorktreeId, providerSessionKey),
  createSession: (provider: SessionProvider, repoPath: string) =>
    ipcRenderer.invoke("session:create", provider, repoPath),
  createWorktreeSession: (provider: SessionProvider, repoPath: string, branchName: string) =>
    ipcRenderer.invoke("session:createWorktree", provider, repoPath, branchName),
  removeWorktree: (provider: SessionProvider, repoPath: string, worktreePath: string) =>
    ipcRenderer.invoke("worktree:remove", provider, repoPath, worktreePath),
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  getGitPathStates: (runtimeSessionId: string) => ipcRenderer.invoke("git:pathStates", runtimeSessionId),
  getGitBranchContext: (runtimeSessionId: string) => ipcRenderer.invoke("git:branchContext", runtimeSessionId),
  getGitDiffDocument: (runtimeSessionId: string, filePath: string) =>
    ipcRenderer.invoke("git:diffDocument", runtimeSessionId, filePath),
  listFiles: (runtimeSessionId: string, relativePath?: string) =>
    ipcRenderer.invoke("files:list", runtimeSessionId, relativePath),
  listAllFiles: (runtimeSessionId: string) => ipcRenderer.invoke("files:listAll", runtimeSessionId),
  resolveRepoFile: (runtimeSessionId: string, filePath: string) =>
    ipcRenderer.invoke("files:resolveRepoFile", runtimeSessionId, filePath),
  syncFileWatchTargets: (runtimeSessionId: string, relativePaths: string[]) =>
    ipcRenderer.invoke("files:syncWatchTargets", runtimeSessionId, relativePaths),
  onErrorAdded: (callback) =>
    ipcRenderer.on("errors:added", (_event, error) => callback(error)),
  onErrorRemoved: (callback) =>
    ipcRenderer.on("errors:removed", (_event, id) => callback(id)),
  onErrorsCleared: (callback) =>
    ipcRenderer.on("errors:cleared", () => callback()),
  onSessionsStateChanged: (callback) =>
    ipcRenderer.on("sessions:stateChanged", (_event, active) => callback(active)),
  onFileTreeChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      runtimeSessionId: string,
      relativePath: string,
    ) => callback(runtimeSessionId, relativePath);
    ipcRenderer.on("files:changed", listener);
    return () => {
      ipcRenderer.removeListener("files:changed", listener);
    };
  },
  attachPty: (runtimeSessionId: string) => ipcRenderer.invoke("pty:attach", runtimeSessionId),
  readyPty: (runtimeSessionId: string) => ipcRenderer.invoke("pty:ready", runtimeSessionId),
  detachPty: (runtimeSessionId: string) => ipcRenderer.invoke("pty:detach", runtimeSessionId),
  ptyWrite: (runtimeSessionId: string, data: string) => ipcRenderer.send("pty:write", runtimeSessionId, data),
  ptyResize: (runtimeSessionId: string, cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", runtimeSessionId, cols, rows),
  onPtyData: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, runtimeSessionId: string, data: string) =>
      callback(runtimeSessionId, data);
    ipcRenderer.on("pty:data", listener);
    return () => {
      ipcRenderer.removeListener("pty:data", listener);
    };
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
