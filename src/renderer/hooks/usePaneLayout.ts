import { type MouseEvent as ReactMouseEvent, type RefObject, useCallback, useState } from "react";
import { clamp } from "../utils/layout";

interface UsePaneLayoutOptions {
  appRef: RefObject<HTMLDivElement | null>;
  sidebarWidth: number;
  workspaceColumnRef: RefObject<HTMLDivElement | null>;
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
  workspaceColumnRef,
}: UsePaneLayoutOptions): PaneLayout {
  const [changesPanelWidth, setChangesPanelWidth] = useState(250);
  const [previewRatio, setPreviewRatio] = useState(0.6);

  const runPointerDrag = useCallback(
    (cursor: string, onMove: (event: globalThis.MouseEvent) => void): void => {
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";

      const handleMouseMove = (event: globalThis.MouseEvent): void => {
        onMove(event);
      };

      const stopDragging = (): void => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", stopDragging);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", stopDragging);
    },
    [],
  );

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
        const reservedWorkspaceWidth = 520;
        const maxWidth = Math.max(220, appWidth - sidebarWidth - reservedWorkspaceWidth);
        setChangesPanelWidth(clamp(startWidth - (moveEvent.clientX - startX), 220, maxWidth));
      });
    },
    [appRef, changesPanelWidth, runPointerDrag, sidebarWidth],
  );

  const handlePreviewResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const workspaceHeight = workspaceColumnRef.current?.clientHeight ?? 0;
      if (workspaceHeight === 0) {
        return;
      }

      const startY = event.clientY;
      const startPreviewHeight = workspaceHeight * previewRatio;

      runPointerDrag("row-resize", (moveEvent) => {
        const minPreviewRatio = Math.min(0.75, 180 / workspaceHeight);
        const maxPreviewRatio = Math.max(minPreviewRatio, 1 - 140 / workspaceHeight);
        const nextRatio = (startPreviewHeight + moveEvent.clientY - startY) / workspaceHeight;
        setPreviewRatio(clamp(nextRatio, minPreviewRatio, maxPreviewRatio));
      });
    },
    [previewRatio, runPointerDrag, workspaceColumnRef],
  );

  return {
    changesPanelWidth,
    previewRatio,
    handleChangesResizeStart,
    handlePreviewResizeStart,
  };
}
