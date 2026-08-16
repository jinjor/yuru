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
function findTextRanges(root: HTMLElement, query: string): Range[] {
  if (query.length === 0) {
    return [];
  }
  const loweredQuery = query.toLowerCase();
  const ranges: Range[] = [];

  for (const block of collectTextBlocks(root)) {
    const searchable = buildSearchableText(block);
    const text = searchable.text.toLowerCase();
    let from = 0;
    while (from <= text.length - loweredQuery.length) {
      const found = text.indexOf(loweredQuery, from);
      if (found < 0) {
        break;
      }
      ranges.push(createRange(searchable, found, found + loweredQuery.length));
      from = found + loweredQuery.length;
    }
  }

  return ranges;
}

interface TextBlock {
  nodes: Text[];
  // <pre> の中は空白と改行がそのまま表示される (ブラウザ既定のスタイル)。それ以外は
  // 続く空白・改行が 1 個の空白として表示される。
  preformatted: boolean;
}

// テキストノードを、続けて 1 つの文字列として検索する単位にまとめる。
function collectTextBlocks(root: HTMLElement): TextBlock[] {
  const blocks: TextBlock[] = [];
  let current: Text[] = [];

  const flush = (preformatted: boolean): void => {
    if (current.length > 0) {
      blocks.push({ nodes: current, preformatted });
      current = [];
    }
  };

  const walk = (element: Element, preformatted: boolean): void => {
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
        walk(child, preformatted);
        continue;
      }
      flush(preformatted);
      const childPreformatted = preformatted || child.tagName === "PRE";
      walk(child, childPreformatted);
      flush(childPreformatted);
    }
  };

  walk(root, false);
  flush(false);
  return blocks;
}

interface SearchableText {
  // 検索する文字列。画面に出ている通りに読めるよう、空白の並びを 1 個の空白に畳んである。
  text: string;
  // text[i] が元のどのテキストノードの何文字目から来たか。Range を作るのに使う。
  nodes: Text[];
  offsets: number[];
}

// ブロックのテキストノードを、画面に見えている文字列と、その 1 文字ずつの出どころに直す。
function buildSearchableText(block: TextBlock): SearchableText {
  const characters: string[] = [];
  const nodes: Text[] = [];
  const offsets: number[] = [];
  // ブロック先頭の空白は表示されないので、空白が続いている状態から始める。
  let inWhitespace = true;

  for (const node of block.nodes) {
    const data = node.data;
    for (let offset = 0; offset < data.length; offset++) {
      const character = data[offset];
      const isWhitespace = !block.preformatted && collapsibleWhitespace.test(character);
      if (isWhitespace && inWhitespace) {
        continue;
      }
      inWhitespace = isWhitespace;
      characters.push(isWhitespace ? " " : character);
      nodes.push(node);
      offsets.push(offset);
    }
  }

  return { text: characters.join(""), nodes, offsets };
}

// CSS が 1 個の空白に畳む文字。
const collapsibleWhitespace = /[ \t\n\r\f]/;

// 見えている文字列の位置 [start, end) を、テキストノードをまたげる Range に直す。
function createRange(searchable: SearchableText, start: number, end: number): Range {
  const range = document.createRange();
  const last = end - 1;
  range.setStart(searchable.nodes[start], searchable.offsets[start]);
  range.setEnd(searchable.nodes[last], searchable.offsets[last] + 1);
  return range;
}
