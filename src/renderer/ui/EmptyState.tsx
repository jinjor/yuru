import type { ReactNode } from "react";

interface EmptyStateProps {
  children: ReactNode;
}

// 一覧やパネルに出すものが無いとき・読み込み中のときに、その理由を出す場所。
// 置かれたコンテナいっぱいに広がって中央に文言を出す。
export function EmptyState({ children }: EmptyStateProps) {
  return <div className="empty-state">{children}</div>;
}
