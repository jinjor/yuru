import { type MouseEvent as ReactMouseEvent, type RefObject, useCallback, useState } from "react";
import { clamp, runPointerDrag } from "./utils/layout";

interface UsePaneLayoutOptions {
  appRef: RefObject<HTMLDivElement | null>;
  sidebarWidth: number;
  sessionViewColumnRef: RefObject<HTMLDivElement | null>;
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
  sessionViewColumnRef,
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
        const reservedSessionViewWidth = 520;
        const maxWidth = Math.max(220, appWidth - sidebarWidth - reservedSessionViewWidth);
        setChangesPanelWidth(clamp(startWidth - (moveEvent.clientX - startX), 220, maxWidth));
      });
    },
    [appRef, changesPanelWidth, sidebarWidth],
  );

  const handlePreviewResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const sessionViewHeight = sessionViewColumnRef.current?.clientHeight ?? 0;
      if (sessionViewHeight === 0) {
        return;
      }

      const startY = event.clientY;
      const startPreviewHeight = sessionViewHeight * previewRatio;

      runPointerDrag("row-resize", (moveEvent) => {
        const minPreviewRatio = Math.min(0.75, 180 / sessionViewHeight);
        const maxPreviewRatio = Math.max(minPreviewRatio, 1 - 140 / sessionViewHeight);
        const nextRatio = (startPreviewHeight + moveEvent.clientY - startY) / sessionViewHeight;
        setPreviewRatio(clamp(nextRatio, minPreviewRatio, maxPreviewRatio));
      });
    },
    [previewRatio, sessionViewColumnRef],
  );

  return {
    changesPanelWidth,
    previewRatio,
    handleChangesResizeStart,
    handlePreviewResizeStart,
  };
}
