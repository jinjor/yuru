import type { ReactNode } from "react";
import type { ReorderDrag } from "../utils/useReorderDrag";

interface TabProps {
  children: ReactNode;
  // その場所だけの見た目 (幅の制限など) を足すときに渡す。
  className?: string;
  // 中身がアイコンだけのとき、または表示が省略されうるときに、
  // 読み上げ用の名前と tooltip として渡す。
  label?: string;
  onSelect: () => void;
  // 並び替えできるタブ列でだけ渡す。掴む対象としての ID と、その列のドラッグ。
  reorder?: { itemId: string; drag: ReorderDrag };
  selected: boolean;
  // タブの右端に置く副操作。閉じるボタンなど。
  trailing?: ReactNode;
}

// アプリ全体で使う、横並びの中から 1 つを選ぶ切り替え。中身は呼び出し側が決める。
// 見た目は外側の div が持ち、選ぶ操作は中の button が持つ。こうすると副操作の
// ボタンを button の入れ子にせず並べられる。
export function Tab({
  children,
  className,
  label,
  onSelect,
  reorder,
  selected,
  trailing,
}: TabProps) {
  return (
    <div
      className={[
        "tab",
        selected ? "selected" : "",
        className ?? "",
        reorder ? reorder.drag.itemClassName(reorder.itemId) : "",
      ]
        .filter((name) => name !== "")
        .join(" ")}
      style={reorder?.drag.itemStyle(reorder.itemId)}
      data-reorder-id={reorder?.itemId}
      onPointerDown={(event) => reorder?.drag.onItemPointerDown(reorder.itemId, event)}
    >
      <button
        type="button"
        className="tab-select"
        // タブの本体はこのボタンなので、並び替えではここも掴める側にする。
        data-reorder-grab={reorder ? "" : undefined}
        aria-current={selected}
        aria-label={label}
        title={label}
        onClick={onSelect}
      >
        {children}
      </button>
      {trailing}
    </div>
  );
}
