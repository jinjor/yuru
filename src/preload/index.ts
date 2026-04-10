import { contextBridge, ipcRenderer } from "electron";
import { AgentDefinition } from "../shared/agent.js";
import { GitHubPullRequest, Session, SessionProvider } from "../shared/session.js";

contextBridge.exposeInMainWorld("electronAPI", {
  getSessions: () => ipcRenderer.invoke("sessions:list"),
  getSessionProviders: () => ipcRenderer.invoke("providers:list") as Promise<AgentDefinition[]>,
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
  getGitBranchContext: (sessionId: string) =>
    ipcRenderer.invoke("git:branchContext", sessionId) as Promise<{
      branch: string | null;
      github: GitHubPullRequest | null;
    }>,
  getGitDiffDocument: (sessionId: string, filePath: string) =>
    ipcRenderer.invoke("git:diffDocument", sessionId, filePath),
  listFiles: (sessionId: string, relativePath?: string) =>
    ipcRenderer.invoke("files:list", sessionId, relativePath),
  readFile: (sessionId: string, filePath: string) =>
    ipcRenderer.invoke("files:read", sessionId, filePath),
  fileExists: (sessionId: string, filePath: string) =>
    ipcRenderer.invoke("files:exists", sessionId, filePath) as Promise<boolean>,
  onSessionsStateChanged: (callback: (active: { sessionId: string; cwd: string }[]) => void) =>
    ipcRenderer.on("sessions:stateChanged", (_event, active) => callback(active)),
  ptyWrite: (sessionId: string, data: string) => ipcRenderer.send("pty:write", sessionId, data),
  ptyResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", sessionId, cols, rows),
  onPtyData: (callback: (sessionId: string, data: string) => void) =>
    ipcRenderer.on("pty:data", (_event, sessionId, data) => callback(sessionId, data)),
});
