import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Highlighter } from "shiki";
import { useMarkdownFind } from "./MarkdownFind";
import type { DiffHunk } from "./diffHunks";
import { getHighlighter } from "./highlight";
import { renderMarkdown } from "./markdownRender";

interface MarkdownPreviewProps {
  content: string;
  // 現在の内容と元の内容の差分。追加された行を含むブロックと削除箇所に印を付けるのに使う。
  hunks: readonly DiffHunk[];
}

export default function MarkdownPreview({ content, hunks }: MarkdownPreviewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const highlighter = useHighlighter();
  // 内容が同じ間は同じオブジェクトを渡す。React は渡されたオブジェクトが変わるたびに innerHTML を
  // 入れ直すので、毎回作ると検索が作った Range (テキストノードを指す) が毎描画で壊れる。
  const renderedHtml = useMemo(
    () => ({ __html: renderMarkdown(content, hunks, highlighter) }),
    [content, hunks, highlighter],
  );
  const findBar = useMarkdownFind(scrollRef, bodyRef, renderedHtml.__html);

  // リンクは BrowserWindow をその URL に遷移させてアプリを壊すので、既定の遷移を必ず止める。
  // http(s) だけ OS の既定ブラウザに渡す。相対リンクやアンカーは遷移を止めるだけにする。
  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) {
      return;
    }
    event.preventDefault();
    const href = anchor.getAttribute("href");
    if (!href || !URL.canParse(href)) {
      return;
    }
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      void window.electronAPI.openExternal(url.toString());
    }
  };

  return (
    <div className="markdown-preview-wrap">
      {findBar}
      <div ref={scrollRef} className="markdown-preview" onClick={handleClick}>
        <div
          ref={bodyRef}
          className="markdown-preview-body"
          dangerouslySetInnerHTML={renderedHtml}
        />
      </div>
    </div>
  );
}

// コードブロックのハイライトに使う shiki。読み込みは動的 import なので、終わるまでは null を
// 返す (その間コードブロックは色無しで出る)。
function useHighlighter(): Highlighter | null {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getHighlighter().then((loaded) => {
      if (!cancelled) {
        setHighlighter(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return highlighter;
}
