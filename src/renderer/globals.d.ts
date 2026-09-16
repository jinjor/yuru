import type { ElectronAPI } from "../shared/ipc";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    __yuruWorktreeViewRenderCounts?: Record<string, number>;
    // preload が YURU_SAVE_ENERGY から設定する polling 方針のスイッチ。false は固定間隔に戻す。
    __yuruSaveEnergy?: boolean;
  }
}

export {};
