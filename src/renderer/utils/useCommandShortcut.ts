import { useEffect } from "react";

interface CommandShortcut {
  // 単一キー。event.key を小文字にしたもので比べる。
  key: string;
  shift?: boolean;
}

// Cmd (macOS) / Ctrl を伴うショートカットを宣言する。window の capture phase で拾うため、
// ターミナルなど内側の要素より先に反応する。
export function useCommandShortcut(shortcut: CommandShortcut, onTrigger: () => void): void {
  const { key, shift = false } = shortcut;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey !== shift) {
        return;
      }
      if (event.key.toLowerCase() !== key) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onTrigger();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [key, shift, onTrigger]);
}
