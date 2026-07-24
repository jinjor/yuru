export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const DRAGGING_CLASS = "is-pane-dragging";

// 分割線のドラッグ。ポインタがプレビューの iframe の上に来るとそちらが当たり判定を
// 取り、move も up もこちらへ届かなくなる。ドラッグ中だけ iframe を当たり判定から外す。
export function runPointerDrag(cursor: string, onMove: (event: MouseEvent) => void): void {
  const previousCursor = document.body.style.cursor;
  const previousUserSelect = document.body.style.userSelect;
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
  document.body.classList.add(DRAGGING_CLASS);

  const stopDragging = (): void => {
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousUserSelect;
    document.body.classList.remove(DRAGGING_CLASS);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", stopDragging);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", stopDragging);
}
