import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getSessions: () => ipcRenderer.invoke("sessions:list"),
  selectSession: (session: unknown) => ipcRenderer.send("session:select", session),
  onSessionEnded: (callback: (sessionId: string) => void) =>
    ipcRenderer.on("session:ended", (_event, sessionId) => callback(sessionId)),
  ptyWrite: (data: string) => ipcRenderer.send("pty:write", data),
  ptyResize: (cols: number, rows: number) => ipcRenderer.send("pty:resize", cols, rows),
  onPtyData: (callback: (data: string) => void) =>
    ipcRenderer.on("pty:data", (_event, data) => callback(data)),
});
