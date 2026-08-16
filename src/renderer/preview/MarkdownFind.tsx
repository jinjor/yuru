import { useEffect, useLayoutEffect, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useFind } from "./Find";

// CSS Custom Highlight API に登録する名前。style.css の ::highlight() と対で使う。
const matchHighlightName = "markdown-find";
const activeMatchHighlightName = "markdown-find-active";

/**
 * Markdown プレビューのファイル内検索。プレビューは markdown-it が作った HTML を
 * innerHTML で流し込んでいるので、マッチは描画後の DOM をテキストで辿って探し、
 * DOM を書き換えずに CSS Custom Highlight API で塗る。
 *
 * scrollRef はスクロールする要素、bodyRef は検索対象のテキストを含む要素。
 */
export function useMarkdownFind(
  scrollRef: RefObject<HTMLElement | null>,
  bodyRef: RefObject<HTMLElement | null>,
  renderedHtml: string,
): ReactNode {
  const [matches, setMatches] = useState<Range[]>([]);
  const { query, activeIndex, findBar } = useFind(matches.length);
  const activeMatch = matches[activeIndex] ?? null;

  // 描画後の DOM から Range を作るので、innerHTML が差し替わったら (= renderedHtml が
  // 変わったら) 前の Range は無効になる。描画のたびに探し直す。
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    setMatches(findTextRanges(body, query));
  }, [bodyRef, renderedHtml, query]);

  useEffect(() => {
    if (matches.length === 0) {
      return;
    }
    // マッチ数だけ引数を並べる new Highlight(...matches) は、一致が数万件あると
    // 引数の上限を超えて落ちる。1 件ずつ足す。
    const highlight = new Highlight();
    for (const match of matches) {
      highlight.add(match);
    }
    CSS.highlights.set(matchHighlightName, highlight);
    return () => {
      CSS.highlights.delete(matchHighlightName);
    };
  }, [matches]);

  useEffect(() => {
    if (activeMatch === null) {
      return;
    }
    const highlight = new Highlight(activeMatch);
    // 選択中のマッチは全体の塗りと重なるので、そちらより優先して塗る。
    highlight.priority = 1;
    CSS.highlights.set(activeMatchHighlightName, highlight);
    return () => {
      CSS.highlights.delete(activeMatchHighlightName);
    };
  }, [activeMatch]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || activeMatch === null) {
      return;
    }
    // Range には scrollIntoView がないので、スクロール量を出して中央に寄せる。
    const rect = activeMatch.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    container.scrollTop +=
      rect.top - containerRect.top - (container.clientHeight - rect.height) / 2;
  }, [scrollRef, activeMatch]);

  return findBar;
}

// HTML のインライン (phrasing) 要素。この中のテキストは前後と地続きに読めるので繋げて検索し、
// それ以外の要素の境目では切る (別々の段落の末尾と先頭が繋がって誤ヒットしないように)。
const inlineTagNames = new Set([
  "A",
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "BR",
  "CITE",
  "CODE",
  "DATA",
  "DEL",
  "DFN",
  "EM",
  "I",
  "IMG",
  "INS",
  "KBD",
  "MARK",
  "Q",
  "RP",
  "RT",
  "RUBY",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "U",
  "VAR",
  "WBR",
]);

// 大文字小文字を無視した部分一致。SourceFind (閲覧モード) の検索と同じ扱いにする。
// 改行や連続する空白は DOM にある通りに扱う (表示上は空白 1 個に見えるので、そこをまたぐ
// 語句は探せない)。
function findTextRanges(root: HTMLElement, query: string): Range[] {
  if (query.length === 0) {
    return [];
  }
  const loweredQuery = query.toLowerCase();
  const ranges: Range[] = [];

  for (const block of collectTextBlocks(root)) {
    const text = block
      .map((node) => node.data)
      .join("")
      .toLowerCase();
    let from = 0;
    while (from <= text.length - loweredQuery.length) {
      const found = text.indexOf(loweredQuery, from);
      if (found < 0) {
        break;
      }
      ranges.push(createRange(block, found, found + loweredQuery.length));
      from = found + loweredQuery.length;
    }
  }

  return ranges;
}

// テキストノードを、続けて 1 つの文字列として検索する単位にまとめる。
function collectTextBlocks(root: HTMLElement): Text[][] {
  const blocks: Text[][] = [];
  let current: Text[] = [];

  const flush = (): void => {
    if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  };

  const walk = (element: Element): void => {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        current.push(node as Text);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      const child = node as Element;
      if (inlineTagNames.has(child.tagName)) {
        walk(child);
        continue;
      }
      flush();
      walk(child);
      flush();
    }
  };

  walk(root);
  flush();
  return blocks;
}

// まとめたテキスト内の位置 [start, end) を、テキストノードをまたげる Range に直す。
function createRange(nodes: readonly Text[], start: number, end: number): Range {
  const range = document.createRange();
  let consumed = 0;

  for (const node of nodes) {
    const nodeEnd = consumed + node.length;
    if (start >= consumed && start < nodeEnd) {
      range.setStart(node, start - consumed);
    }
    if (end > consumed && end <= nodeEnd) {
      range.setEnd(node, end - consumed);
      break;
    }
    consumed = nodeEnd;
  }

  return range;
}
