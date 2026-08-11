import { useEffect } from "react";

interface ModalProps {
  onClose: () => void;
  topOffset: number;
  children: React.ReactNode;
}

// アプリ全体で使う、背面を覆うダイアログの土台。
// 背景クリックと Escape のどちらでも onClose を呼ぶので、閉じてよいかの判断は
// 呼び出し側が onClose の中で行う。
export function Modal({ onClose, topOffset, children }: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="modal" style={{ paddingTop: topOffset }}>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-content">{children}</div>
    </div>
  );
}
