import { type MouseEvent as ReactMouseEvent, type RefObject, useCallback, useState } from "react";
import { clamp, runPointerDrag } from "../utils/layout";

interface UsePaneLayoutOptions {
  appRef: RefObject<HTMLDivElement | null>;
  sidebarWidth: number;
  worktreeViewColumnRef: RefObject<HTMLDivElement | null>;
}

interface PaneLayout {
  changesPanelWidth: number;
  previewRatio: number;
  handleChangesResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handlePreviewResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

export function usePaneLayout({
  appRef,
  sidebarWidth,
  worktreeViewColumnRef,
}: UsePaneLayoutOptions): PaneLayout {
  const [changesPanelWidth, setChangesPanelWidth] = useState(375);
  const [previewRatio, setPreviewRatio] = useState(0.6);

  const handleChangesResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = changesPanelWidth;
      const appWidth = appRef.current?.clientWidth ?? 0;
      if (appWidth === 0) {
        return;
      }

      runPointerDrag("col-resize", (moveEvent) => {
        const reservedWorktreeViewWidth = 520;
        const maxWidth = Math.max(220, appWidth - sidebarWidth - reservedWorktreeViewWidth);
        setChangesPanelWidth(clamp(startWidth - (moveEvent.clientX - startX), 220, maxWidth));
      });
    },
    [appRef, changesPanelWidth, sidebarWidth],
  );

  const handlePreviewResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const worktreeViewHeight = worktreeViewColumnRef.current?.clientHeight ?? 0;
      if (worktreeViewHeight === 0) {
        return;
      }

      const startY = event.clientY;
      const startPreviewHeight = worktreeViewHeight * previewRatio;

      runPointerDrag("row-resize", (moveEvent) => {
        const minPreviewRatio = Math.min(0.75, 180 / worktreeViewHeight);
        const maxPreviewRatio = Math.max(minPreviewRatio, 1 - 140 / worktreeViewHeight);
        const nextRatio = (startPreviewHeight + moveEvent.clientY - startY) / worktreeViewHeight;
        setPreviewRatio(clamp(nextRatio, minPreviewRatio, maxPreviewRatio));
      });
    },
    [previewRatio, worktreeViewColumnRef],
  );

  return {
    changesPanelWidth,
    previewRatio,
    handleChangesResizeStart,
    handlePreviewResizeStart,
  };
}
