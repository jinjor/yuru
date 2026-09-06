import { type MouseEvent, useMemo, useRef } from "react";
import { useMarkdownFind } from "./MarkdownFind";
import { renderMarkdown, type Deletion } from "./markdownRender";

interface MarkdownPreviewProps {
  content: string;
  // 現在の内容で追加・変更された行 (1-based)。空なら変更マークを出さない。
  changedLines: ReadonlySet<number>;
  // 削除箇所。位置だけを示す (中身はプレビューに出せない)。行の書き換えは追加と削除の両方に出る。
  deletions: readonly Deletion[];
}

export default function MarkdownPreview({
  content,
  changedLines,
  deletions,
}: MarkdownPreviewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 内容が同じ間は同じオブジェクトを渡す。React は渡されたオブジェクトが変わるたびに innerHTML を
  // 入れ直すので、毎回作ると検索が作った Range (テキストノードを指す) が毎描画で壊れる。
  const renderedHtml = useMemo(
    () => ({ __html: renderMarkdown(content, changedLines, deletions) }),
    [content, changedLines, deletions],
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
