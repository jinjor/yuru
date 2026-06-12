import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI, GitDiffScope } from "../shared/ipc.js";
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
  openWorktreeTerminal: (worktreeId: string) =>
    ipcRenderer.invoke("worktreeTerminal:open", worktreeId),
  createWorktreeSession: (provider: SessionProvider, repoPath: string, branchName: string) =>
    ipcRenderer.invoke("session:createWorktree", provider, repoPath, branchName),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  getGitPathStates: (worktreeId: string) => ipcRenderer.invoke("git:pathStates", worktreeId),
  getGitDiffDocument: (worktreeId: string, filePath: string, scope?: GitDiffScope) =>
    ipcRenderer.invoke("git:diffDocument", worktreeId, filePath, scope),
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
  onTerminalRuntimeExited: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, terminalRuntimeId: string) =>
      callback(terminalRuntimeId);
    ipcRenderer.on("terminalRuntime:exited", listener);
    return () => {
      ipcRenderer.removeListener("terminalRuntime:exited", listener);
    };
  },
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
  attachPty: (terminalRuntimeId: string) => ipcRenderer.invoke("pty:attach", terminalRuntimeId),
  readyPty: (terminalRuntimeId: string) => ipcRenderer.invoke("pty:ready", terminalRuntimeId),
  detachPty: (terminalRuntimeId: string) => ipcRenderer.invoke("pty:detach", terminalRuntimeId),
  ptyWrite: (terminalRuntimeId: string, data: string) =>
    ipcRenderer.send("pty:write", terminalRuntimeId, data),
  ptyResize: (terminalRuntimeId: string, cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", terminalRuntimeId, cols, rows),
  onPtyData: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, terminalRuntimeId: string, data: string) =>
      callback(terminalRuntimeId, data);
    ipcRenderer.on("pty:data", listener);
    return () => {
      ipcRenderer.removeListener("pty:data", listener);
    };
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
