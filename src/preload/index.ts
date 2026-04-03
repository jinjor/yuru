import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getSessions: () => ipcRenderer.invoke("sessions:list"),
  selectSession: (session: unknown) => ipcRenderer.send("session:select", session),
  onSessionEnded: (callback: (sessionId: string) => void) =>
    ipcRenderer.on("session:ended", (_event, sessionId) => callback(sessionId)),
  ptyWrite: (sessionId: string, data: string) => ipcRenderer.send("pty:write", sessionId, data),
  ptyResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", sessionId, cols, rows),
  onPtyData: (callback: (sessionId: string, data: string) => void) =>
    ipcRenderer.on("pty:data", (_event, sessionId, data) => callback(sessionId, data)),
});
