import type { ElectronAPI } from "../shared/ipc";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    __yuruWorktreeViewRenderCounts?: Record<string, number>;
  }
}

export {};
