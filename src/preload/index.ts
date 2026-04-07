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
  getGitBranch: (sessionId: string) =>
    ipcRenderer.invoke("git:branch", sessionId) as Promise<string | null>,
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
