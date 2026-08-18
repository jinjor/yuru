import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { clamp } from "./layout";

// これ未満で離したら並び替えではなくクリック。
const DRAG_THRESHOLD_PX = 4;
// スクロールコンテナの端から何 px を自動スクロールの反応域にするか。端で最大速度になる。
const AUTO_SCROLL_ZONE_PX = 28;
const AUTO_SCROLL_MAX_SPEED_PX = 14;
// ドラッグ中はポインタが preview の iframe に入ると move / up が届かなくなるため、
// pane のリサイズ (runPointerDrag) と同じく body の class で当たり判定を切る。
const DRAGGING_BODY_CLASS = "is-reorder-dragging";

export interface ReorderItemMetrics {
  // スクロールコンテナの content 座標 (viewport 座標 + scrollTop)。この座標で持つと
  // 自動スクロールしても測り直さずに済む。
  top: number;
  height: number;
}

interface DragSession {
  itemIds: readonly string[];
  metrics: ReorderItemMetrics[];
  fromIndex: number;
  // 掴んだ項目が占める縦幅 (高さ + 隣との隙間)。どく項目はこの分だけずれる。
  slotSize: number;
  minOffset: number;
  maxOffset: number;
  container: HTMLElement;
  containerTop: number;
  containerBottom: number;
  startContentY: number;
  pointerY: number;
  targetIndex: number;
  frameId: number;
}

interface DragView {
  itemIds: readonly string[];
  itemId: string;
  fromIndex: number;
  targetIndex: number;
  offset: number;
  slotSize: number;
}

export interface ReorderDrag {
  itemClassName: (itemId: string) => string;
  itemStyle: (itemId: string) => CSSProperties | undefined;
  onItemPointerDown: (itemId: string, event: ReactPointerEvent) => void;
}

interface ReorderDragOptions {
  // 現在の並び。ドラッグ中にこれが変わったら書き込まずに取り消す。
  itemIds: readonly string[];
  // 項目を含むスクロールコンテナ。項目は data-reorder-id 属性で探す。
  containerRef: RefObject<HTMLElement | null>;
  // 並びが変わって離したときだけ呼ぶ。渡すのは並び替え後の全 ID。
  onReorder: (itemIds: string[]) => void;
}

// 1 つの入れ物の中を縦に並び替える drag & drop。掴んだ項目はポインタに追従し、
// 落ちる場所を空けるために他の項目が 1 スロット分ずれる。
export function useReorderDrag({
  itemIds,
  containerRef,
  onReorder,
}: ReorderDragOptions): ReorderDrag {
  const sessionRef = useRef<DragSession | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [view, setView] = useState<DragView | null>(null);

  const onItemPointerDown = useCallback(
    (itemId: string, event: ReactPointerEvent): void => {
      if (event.button !== 0 || stopRef.current) {
        return;
      }
      // 項目の中の副操作ボタン (repo 行の + など) の上では並び替えを始めない。
      if ((event.target as HTMLElement).closest("button")) {
        return;
      }
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const startX = event.clientX;
      const startY = event.clientY;
      const currentItemIds = [...itemIds];

      // ポインタの位置から落ちる位置を決め直す。ポインタが動いた時と、止まったまま
      // 自動スクロールした時の両方から呼ぶ。
      const applyPointer = (session: DragSession, pointerY: number): void => {
        session.pointerY = pointerY;
        const offset = toOffset(session);
        session.targetIndex = resolveTargetIndex(
          session.metrics,
          session.fromIndex,
          session.slotSize,
          offset,
        );
        setView((previous) =>
          previous && previous.offset === offset && previous.targetIndex === session.targetIndex
            ? previous
            : {
                itemIds: session.itemIds,
                itemId,
                fromIndex: session.fromIndex,
                targetIndex: session.targetIndex,
                offset,
                slotSize: session.slotSize,
              },
        );
      };

      const step = (): void => {
        const session = sessionRef.current;
        if (!session) {
          return;
        }
        autoScroll(session, toOffset(session));
        applyPointer(session, session.pointerY);
        session.frameId = requestAnimationFrame(step);
      };

      const stop = (): void => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", stop);
        window.removeEventListener("keydown", handleKeyDown);
        stopRef.current = null;
        const session = sessionRef.current;
        if (!session) {
          return;
        }
        cancelAnimationFrame(session.frameId);
        sessionRef.current = null;
        document.body.classList.remove(DRAGGING_BODY_CLASS);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        setView(null);
      };

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const session = sessionRef.current;
        if (session) {
          applyPointer(session, moveEvent.clientY);
          return;
        }
        if (
          Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        const started = startSession(container, currentItemIds, itemId, startY);
        if (!started) {
          stop();
          return;
        }
        sessionRef.current = started;
        document.body.classList.add(DRAGGING_BODY_CLASS);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        applyPointer(started, moveEvent.clientY);
        step();
      };

      const handlePointerUp = (upEvent: PointerEvent): void => {
        const session = sessionRef.current;
        // 最後の pointermove と pointerup が同じフレームに続けて届くこともあるので、
        // 離した位置で決め直してから確定する。
        if (session) {
          applyPointer(session, upEvent.clientY);
        }
        const targetIndex = session?.targetIndex;
        const fromIndex = session?.fromIndex;
        stop();
        if (targetIndex === undefined || fromIndex === undefined || targetIndex === fromIndex) {
          return;
        }
        onReorder(moveItem(currentItemIds, fromIndex, targetIndex));
      };

      const handleKeyDown = (keyEvent: KeyboardEvent): void => {
        if (keyEvent.key !== "Escape") {
          return;
        }
        // 取り消しは元の並びに戻すだけで、何も書かない。
        stop();
      };

      stopRef.current = stop;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", stop);
      window.addEventListener("keydown", handleKeyDown);
    },
    [containerRef, itemIds, onReorder],
  );

  const itemIdsKey = itemIds.join("\n");
  useEffect(() => {
    // ドラッグ中に項目が増減すると開始時に測った矩形が実物と食い違うため、取り消す。
    return () => {
      stopRef.current?.();
    };
  }, [itemIdsKey]);

  return {
    itemClassName: (itemId) => toItemClassName(view, itemId),
    itemStyle: (itemId) => toItemStyle(view, itemId),
    onItemPointerDown,
  };
}

function toItemClassName(view: DragView | null, itemId: string): string {
  if (!view) {
    return "";
  }
  return itemId === view.itemId ? "reorder-dragging" : "reorder-shift";
}

function toItemStyle(view: DragView | null, itemId: string): CSSProperties | undefined {
  if (!view) {
    return undefined;
  }
  if (itemId === view.itemId) {
    return { transform: `translateY(${view.offset}px)` };
  }
  const index = view.itemIds.indexOf(itemId);
  if (index < 0) {
    return undefined;
  }
  return { transform: `translateY(${toShift(view, index)}px)` };
}

// 掴んだ項目が抜けた場所と落ちる場所の間にある項目だけが 1 スロット分ずれる。
function toShift(view: DragView, index: number): number {
  if (view.fromIndex < index && index <= view.targetIndex) {
    return -view.slotSize;
  }
  if (view.targetIndex <= index && index < view.fromIndex) {
    return view.slotSize;
  }
  return 0;
}

function startSession(
  container: HTMLElement,
  itemIds: readonly string[],
  itemId: string,
  startY: number,
): DragSession | null {
  const fromIndex = itemIds.indexOf(itemId);
  if (fromIndex < 0 || itemIds.length < 2) {
    return null;
  }
  const containerRect = container.getBoundingClientRect();
  const elementsById = new Map<string, Element>();
  for (const element of container.querySelectorAll("[data-reorder-id]")) {
    const id = element.getAttribute("data-reorder-id");
    if (id !== null) {
      elementsById.set(id, element);
    }
  }
  const metrics: ReorderItemMetrics[] = [];
  for (const id of itemIds) {
    const element = elementsById.get(id);
    if (!element) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    metrics.push({
      top: rect.top - containerRect.top + container.scrollTop,
      height: rect.height,
    });
  }

  const dragged = metrics[fromIndex];
  const first = metrics[0];
  const last = metrics[metrics.length - 1];
  return {
    itemIds,
    metrics,
    fromIndex,
    slotSize: toSlotSize(metrics, fromIndex),
    // 掴んだ項目は自分の入れ物から出られない。
    minOffset: first.top - dragged.top,
    maxOffset: last.top + last.height - dragged.height - dragged.top,
    container,
    containerTop: containerRect.top,
    containerBottom: containerRect.bottom,
    startContentY: startY - containerRect.top + container.scrollTop,
    pointerY: startY,
    targetIndex: fromIndex,
    frameId: 0,
  };
}

// 掴んだ項目を抜くと詰まる縦幅。隣との隙間を含むので、項目の高さがばらばらでも
// 間にある項目はどれもちょうどこの分だけずれる。
export function toSlotSize(metrics: readonly ReorderItemMetrics[], fromIndex: number): number {
  const dragged = metrics[fromIndex];
  const next = metrics[fromIndex + 1];
  if (next) {
    return next.top - dragged.top;
  }
  const previous = metrics[fromIndex - 1];
  return dragged.top + dragged.height - (previous.top + previous.height);
}

function toOffset(session: DragSession): number {
  const pointerContentY = session.pointerY - session.containerTop + session.container.scrollTop;
  return clamp(pointerContentY - session.startContentY, session.minOffset, session.maxOffset);
}

// 落ちる位置 = 掴んだ項目より手前に来る項目の数。基準は「掴んだ項目を抜いた後」の
// 各項目の中心で、掴んだ項目が抜けた分 (index が後ろなら 1 スロット) だけ詰めて考える。
// 比較する位置はその中心から半スロット後ろ = 「その項目の前に置く」場合と「後ろに置く」
// 場合のちょうど中間なので、半スロット動かすたびに 1 つずつ入れ替わる。基準側は
// ドラッグ中ずっと動かないため、境界で行ったり来たりするちらつきも起きない。
export function resolveTargetIndex(
  metrics: readonly ReorderItemMetrics[],
  fromIndex: number,
  slotSize: number,
  offset: number,
): number {
  const dragged = metrics[fromIndex];
  const draggedCenter = dragged.top + dragged.height / 2 + offset;
  let targetIndex = 0;
  for (const [index, item] of metrics.entries()) {
    if (index === fromIndex) {
      continue;
    }
    const center = item.top + item.height / 2 - (index > fromIndex ? slotSize : 0);
    if (center + slotSize / 2 < draggedCenter) {
      targetIndex += 1;
    }
  }
  return targetIndex;
}

function autoScroll(session: DragSession, offset: number): void {
  const maxScrollTop = session.container.scrollHeight - session.container.clientHeight;
  if (maxScrollTop <= 0) {
    return;
  }
  const distanceFromTop = session.pointerY - session.containerTop;
  const distanceFromBottom = session.containerBottom - session.pointerY;
  // 掴んだ項目がその方向の端に達していたら、行き止まりなのでスクロールもしない。
  if (distanceFromTop < AUTO_SCROLL_ZONE_PX && offset > session.minOffset) {
    session.container.scrollTop = Math.max(
      0,
      session.container.scrollTop - toAutoScrollSpeed(distanceFromTop),
    );
    return;
  }
  if (distanceFromBottom < AUTO_SCROLL_ZONE_PX && offset < session.maxOffset) {
    session.container.scrollTop = Math.min(
      maxScrollTop,
      session.container.scrollTop + toAutoScrollSpeed(distanceFromBottom),
    );
  }
}

function toAutoScrollSpeed(distance: number): number {
  return (
    AUTO_SCROLL_MAX_SPEED_PX * clamp((AUTO_SCROLL_ZONE_PX - distance) / AUTO_SCROLL_ZONE_PX, 0, 1)
  );
}

export function moveItem(itemIds: readonly string[], fromIndex: number, toIndex: number): string[] {
  const next = [...itemIds];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
