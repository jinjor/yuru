import type { MouseEvent, ReactNode } from "react";

interface IconButtonProps {
  children: ReactNode;
  // 追加の見た目 (絶対配置やホバーでの出現など) を持たせるときだけ渡す。
  className?: string;
  disabled?: boolean;
  // アイコンしか出ないので、読み上げ用の名前として必ず渡す。
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  size?: "sm" | "md";
  // tooltip に label と別の文言 (ショートカットの併記など) を出したいときだけ渡す。
  title?: string;
}

// アプリ全体で使う、アイコンだけのボタン。閉じる・破棄・メニュー・送りなどに使う。
export function IconButton({
  children,
  className,
  disabled,
  label,
  onClick,
  size = "md",
  title,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${size}${className ? ` ${className}` : ""}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
    >
      {children}
    </button>
  );
}
