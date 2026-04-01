import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  ptyWrite: (data: string) => ipcRenderer.send("pty:write", data),
  ptyResize: (cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", cols, rows),
  onPtyData: (callback: (data: string) => void) =>
    ipcRenderer.on("pty:data", (_event, data) => callback(data)),
});
