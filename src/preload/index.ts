import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "../shared/ipc.js";
import type { SessionProvider } from "../shared/session.js";

const electronAPI: ElectronAPI = {
  getRepos: () => ipcRenderer.invoke("metadata:listRepos"),
  getSessionProviders: () => ipcRenderer.invoke("providers:list"),
  getErrors: () => ipcRenderer.invoke("errors:list"),
  dismissError: (id: string) => ipcRenderer.invoke("errors:dismiss", id),
  clearErrors: () => ipcRenderer.invoke("errors:clear"),
  resumePrimarySession: (worktreeId: string, providerSessionKey: string) =>
    ipcRenderer.invoke("worktreeSession:resumePrimary", worktreeId, providerSessionKey),
  resumeSuggestedSession: (worktreeId: string, providerSessionKey: string) =>
    ipcRenderer.invoke("worktreeSession:resumeSuggested", worktreeId, providerSessionKey),
  createSessionForWorktree: (worktreeId: string, provider: SessionProvider) =>
    ipcRenderer.invoke("worktreeSession:create", worktreeId, provider),
  createWorktreeSession: (provider: SessionProvider, repoPath: string, branchName: string) =>
    ipcRenderer.invoke("session:createWorktree", provider, repoPath, branchName),
  removeWorktree: (repoPath: string, worktreePath: string) =>
    ipcRenderer.invoke("worktree:remove", repoPath, worktreePath),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  getGitPathStates: (worktreeId: string) => ipcRenderer.invoke("git:pathStates", worktreeId),
  getGitDiffDocument: (worktreeId: string, filePath: string) =>
    ipcRenderer.invoke("git:diffDocument", worktreeId, filePath),
  listFiles: (worktreeId: string, relativePath?: string) =>
    ipcRenderer.invoke("files:list", worktreeId, relativePath),
  listAllFiles: (worktreeId: string) => ipcRenderer.invoke("files:listAll", worktreeId),
  resolveRepoFile: (worktreeId: string, filePath: string) =>
    ipcRenderer.invoke("files:resolveRepoFile", worktreeId, filePath),
  syncFileWatchTargets: (worktreeId: string, relativePaths: string[]) =>
    ipcRenderer.invoke("files:syncWatchTargets", worktreeId, relativePaths),
  searchCode: (worktreeId: string, query: string) =>
    ipcRenderer.invoke("search:code", worktreeId, query),
  cancelCodeSearch: (worktreeId: string) => ipcRenderer.invoke("search:cancelCode", worktreeId),
  onErrorAdded: (callback) => ipcRenderer.on("errors:added", (_event, error) => callback(error)),
  onErrorRemoved: (callback) => ipcRenderer.on("errors:removed", (_event, id) => callback(id)),
  onErrorsCleared: (callback) => ipcRenderer.on("errors:cleared", () => callback()),
  onWorktreeDisplayChanged: (callback) =>
    ipcRenderer.on("worktree:displayChanged", (_event, update) => callback(update)),
  onSessionsStateChanged: (callback) => ipcRenderer.on("sessions:stateChanged", () => callback()),
  onFileTreeChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      worktreeId: string,
      relativePath: string,
    ) => callback(worktreeId, relativePath);
    ipcRenderer.on("files:changed", listener);
    return () => {
      ipcRenderer.removeListener("files:changed", listener);
    };
  },
  attachPty: (runtimeSessionId: string) => ipcRenderer.invoke("pty:attach", runtimeSessionId),
  readyPty: (runtimeSessionId: string) => ipcRenderer.invoke("pty:ready", runtimeSessionId),
  detachPty: (runtimeSessionId: string) => ipcRenderer.invoke("pty:detach", runtimeSessionId),
  ptyWrite: (runtimeSessionId: string, data: string) =>
    ipcRenderer.send("pty:write", runtimeSessionId, data),
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
