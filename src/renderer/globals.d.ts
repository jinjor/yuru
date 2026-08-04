import type { ElectronAPI } from "../shared/ipc";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    __yuruSessionViewRenderCounts?: Record<string, number>;
  }
}

export {};
