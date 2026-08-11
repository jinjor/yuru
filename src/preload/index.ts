import { contextBridge, ipcRenderer } from "electron";
import type {
  AppErrorNotice,
  ElectronAPI,
  GitDiffScope,
  PullRequestUpdate,
  SessionUpdate,
  WorktreeProcessRef,
} from "../shared/ipc.js";
import type { ProviderPlanUsage, SessionProvider } from "../shared/session.js";

const electronAPI: ElectronAPI = {
  getRepos: () => ipcRenderer.invoke("metadata:listRepos"),
  getProviderPlanUsage: () => ipcRenderer.invoke("providerPlanUsage:list"),
  getErrors: () => ipcRenderer.invoke("errors:list"),
  dismissError: (id: string) => ipcRenderer.invoke("errors:dismiss", id),
  clearErrors: () => ipcRenderer.invoke("errors:clear"),
  reportRendererError: (message: string, detail?: string) =>
    ipcRenderer.send("errors:reportRenderer", message, detail),
  resumePrimarySession: (worktreeId: string, agentSessionKey: string) =>
    ipcRenderer.invoke("worktreeSession:resumePrimary", worktreeId, agentSessionKey),
  resumeSuggestedSession: (worktreeId: string, agentSessionKey: string) =>
    ipcRenderer.invoke("worktreeSession:resumeSuggested", worktreeId, agentSessionKey),
  detachPrimarySession: (worktreeId: string, agentSessionKey: string) =>
    ipcRenderer.invoke("worktreeSession:detachPrimary", worktreeId, agentSessionKey),
  createSessionForWorktree: (worktreeId: string, provider: SessionProvider) =>
    ipcRenderer.invoke("worktreeSession:create", worktreeId, provider),
  openWorktreeTerminal: (worktreeId: string) =>
    ipcRenderer.invoke("worktreeTerminal:open", worktreeId),
  killTerminalRuntime: (terminalRuntimeId: string) =>
    ipcRenderer.invoke("terminalRuntime:kill", terminalRuntimeId),
  createTaskWorktree: (repoPath: string, branchName: string) =>
    ipcRenderer.invoke("worktree:create", repoPath, branchName),
  createTaskWorktreeFromRemoteBranch: (repoPath: string, branchName: string) =>
    ipcRenderer.invoke("worktree:createFromRemoteBranch", repoPath, branchName),
  prepareWorktreeRemoval: (
    worktreeId: string,
    force: boolean,
    processesToStop?: WorktreeProcessRef[],
  ) => ipcRenderer.invoke("worktree:prepareRemoval", worktreeId, force, processesToStop),
  executeWorktreeRemoval: (worktreeId: string, force: boolean) =>
    ipcRenderer.invoke("worktree:executeRemoval", worktreeId, force),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  getGitPathStates: (worktreeId: string) => ipcRenderer.invoke("git:pathStates", worktreeId),
  getReviewState: (worktreeId: string) => ipcRenderer.invoke("git:reviewState", worktreeId),
  setFileReviewed: (
    worktreeId: string,
    path: string,
    scope: GitDiffScope | undefined,
    reviewed: boolean,
  ) => ipcRenderer.invoke("git:setFileReviewed", worktreeId, path, scope, reviewed),
  getGitDiffDocument: (worktreeId: string, filePath: string, scope?: GitDiffScope) =>
    ipcRenderer.invoke("git:diffDocument", worktreeId, filePath, scope),
  getImageDiffDocument: (worktreeId: string, filePath: string, scope?: GitDiffScope) =>
    ipcRenderer.invoke("git:imageDiffDocument", worktreeId, filePath, scope),
  createHtmlPreview: (worktreeId: string, filePath: string, content: string) =>
    ipcRenderer.invoke("htmlPreview:create", worktreeId, filePath, content),
  releaseHtmlPreview: (grantId: string) => ipcRenderer.invoke("htmlPreview:release", grantId),
  listFiles: (worktreeId: string, relativePath?: string) =>
    ipcRenderer.invoke("files:list", worktreeId, relativePath),
  listAllFiles: (worktreeId: string) => ipcRenderer.invoke("files:listAll", worktreeId),
  resolveRepoFile: (worktreeId: string, filePath: string) =>
    ipcRenderer.invoke("files:resolveRepoFile", worktreeId, filePath),
  readWorktreeFile: (worktreeId: string, filePath: string) =>
    ipcRenderer.invoke("files:readWorktree", worktreeId, filePath),
  writeFile: (worktreeId: string, filePath: string, content: string) =>
    ipcRenderer.invoke("files:write", worktreeId, filePath, content),
  syncFileWatchTargets: (worktreeId: string, relativePaths: string[]) =>
    ipcRenderer.invoke("files:syncWatchTargets", worktreeId, relativePaths),
  searchCode: (worktreeId: string, query: string) =>
    ipcRenderer.invoke("search:code", worktreeId, query),
  cancelCodeSearch: (worktreeId: string) => ipcRenderer.invoke("search:cancelCode", worktreeId),
  onErrorNoticesChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, notices: AppErrorNotice[]) =>
      callback(notices);
    ipcRenderer.on("errors:changed", listener);
    return () => {
      ipcRenderer.removeListener("errors:changed", listener);
    };
  },
  onRepoListChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("repos:changed", listener);
    return () => {
      ipcRenderer.removeListener("repos:changed", listener);
    };
  },
  onTerminalRuntimeExited: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, terminalRuntimeId: string) =>
      callback(terminalRuntimeId);
    ipcRenderer.on("terminalRuntime:exited", listener);
    return () => {
      ipcRenderer.removeListener("terminalRuntime:exited", listener);
    };
  },
  onSessionChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      terminalRuntimeId: string,
      update: SessionUpdate,
    ) => callback(terminalRuntimeId, update);
    ipcRenderer.on("session:changed", listener);
    return () => {
      ipcRenderer.removeListener("session:changed", listener);
    };
  },
  onPullRequestsChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, updates: PullRequestUpdate[]) =>
      callback(updates);
    ipcRenderer.on("pullRequests:changed", listener);
    return () => {
      ipcRenderer.removeListener("pullRequests:changed", listener);
    };
  },
  onProviderPlanUsageChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, usages: ProviderPlanUsage[]) =>
      callback(usages);
    ipcRenderer.on("providerPlanUsage:changed", listener);
    return () => {
      ipcRenderer.removeListener("providerPlanUsage:changed", listener);
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

// Electron は同じ BrowserWindow 内の iframe にも preload を読み込む。preview HTML へ
// filesystem や PTY の IPC を渡さないよう、bridge は Yuru 本体の frame だけに公開する。
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld("electronAPI", electronAPI);
}
