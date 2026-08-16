import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { IconButton } from "../ui/IconButton";

interface Find {
  /** 検索文字列。バーを閉じている間は "" (どこも検索していない状態)。 */
  query: string;
  /** 前後移動で選んでいるマッチの番号 (0-based)。1 件も見つかっていなければ 0。 */
  activeIndex: number;
  /** 検索バー。閉じている間は null。 */
  findBar: ReactNode;
}

/**
 * Cmd+F で開くファイル内検索のバー。何をマッチとするかは表示の作り (行のトークンか、
 * 描画後の DOM か) で違うので、呼び出し側が query からマッチを求めて件数だけを渡す。
 * 件数表示と前後移動はこの hook が受け持つ。
 */
export function useFind(matchCount: number): Find {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Cmd+F を押すたびに増やす。開いたままでも入力を選び直せるようにするため。
  const [focusRequest, setFocusRequest] = useState(0);
  // 何番目のマッチを選んでいるか。件数は入力より遅れて減ることがあるので、表示に使う前に丸める。
  const [cursor, setCursor] = useState(0);
  const activeIndex = Math.min(cursor, Math.max(matchCount - 1, 0));

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isFindShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "f";
      if (!isFindShortcut) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(true);
      setFocusRequest((prev) => prev + 1);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  useEffect(() => {
    if (focusRequest === 0) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  const goToMatch = (delta: number): void => {
    if (matchCount === 0) {
      return;
    }
    setCursor((activeIndex + delta + matchCount) % matchCount);
  };

  const handleFindKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      goToMatch(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  const findBar = isOpen ? (
    <div className="find-bar">
      <input
        ref={inputRef}
        autoFocus
        className="find-input"
        onChange={(event) => {
          setQuery(event.target.value);
          setCursor(0);
        }}
        onKeyDown={handleFindKeyDown}
        placeholder="Find"
        value={query}
      />
      <span className="find-count">
        {query.length === 0 ? "" : `${matchCount === 0 ? 0 : activeIndex + 1}/${matchCount}`}
      </span>
      <IconButton
        size="sm"
        onClick={() => goToMatch(-1)}
        disabled={matchCount === 0}
        label="Previous match"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp size={14} strokeWidth={2.4} />
      </IconButton>
      <IconButton
        size="sm"
        onClick={() => goToMatch(1)}
        disabled={matchCount === 0}
        label="Next match"
        title="Next match (Enter)"
      >
        <ChevronDown size={14} strokeWidth={2.4} />
      </IconButton>
      <IconButton
        size="sm"
        onClick={() => setIsOpen(false)}
        label="Close find"
        title="Close find (Escape)"
      >
        <X size={14} strokeWidth={2.4} />
      </IconButton>
    </div>
  ) : null;

  return { query: isOpen ? query : "", activeIndex, findBar };
}
