import type { ReactNode } from "react";

// アプリ全体で使う、ラベル付きの操作ボタン。
// primary は実行、neutral は取り消しや補助操作、danger は破壊的な操作に使う。
type ButtonVariant = "primary" | "neutral" | "danger";

interface ButtonProps {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  variant?: ButtonVariant;
}

export function Button({ children, disabled, onClick, title, variant = "neutral" }: ButtonProps) {
  return (
    <button
      type="button"
      className={`button ${variant}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
