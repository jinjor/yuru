import { type MouseEvent, useMemo } from "react";
import MarkdownIt from "markdown-it";
import { extendMarkdownItWithFrontmatter } from "./markdownFrontmatter";

// html: false で生 HTML を埋め込ませない (エスケープする)。出力タグは markdown-it が生成する
// 安全なものだけになるので、renderer に innerHTML で流し込んでよい。
const md = new MarkdownIt({ html: false, linkify: true });
extendMarkdownItWithFrontmatter(md);

type MdToken = ReturnType<typeof md.parse>[number];

interface Deletion {
  // 削除直後の現在行 (1-based)。atEnd は文末での削除。
  line: number;
  atEnd: boolean;
}

interface MarkdownPreviewProps {
  content: string;
  // 現在の内容で追加・変更された行 (1-based)。空なら変更マークを出さない。
  changedLines: ReadonlySet<number>;
  // 隣に追加のない純粋な削除箇所。位置だけを示す (中身はプレビューに出せない)。
  deletions: readonly Deletion[];
}

// markdown-it の token.map は [開始, 終了] の 0-based・終了排他。1-based の行範囲に直して、
// その範囲に変更行が 1 つでも含まれるかを見る。
function rangeHasChange(
  map: readonly [number, number],
  changedLines: ReadonlySet<number>,
): boolean {
  for (let line = map[0] + 1; line <= map[1]; line++) {
    if (changedLines.has(line)) {
      return true;
    }
  }
  return false;
}

interface TopLevelBlock {
  // ブロック先頭の現在行 (1-based)。
  startLine: number;
  tokens: MdToken[];
}

// トークン列をトップレベルのブロック単位に切り出す。変更マークも削除マーカーもこの粒度で扱う
// (リストや引用の入れ子は丸ごと 1 ブロック)。
function splitTopLevelBlocks(tokens: MdToken[]): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = [];
  let depth = 0;
  let current: MdToken[] | null = null;
  let startLine = 0;

  for (const token of tokens) {
    if (current === null) {
      current = [];
      startLine = token.map ? token.map[0] + 1 : 0;
    }
    current.push(token);

    if (token.nesting === 1) {
      depth += 1;
    } else if (token.nesting === -1) {
      depth -= 1;
    }

    if (depth === 0) {
      blocks.push({ startLine, tokens: current });
      current = null;
    }
  }

  return blocks;
}

const removedMarkerHtml = '<div class="md-removed" aria-label="lines removed"></div>';

function renderMarkdown(
  content: string,
  changedLines: ReadonlySet<number>,
  deletions: readonly Deletion[],
): string {
  const env = {};
  const blocks = splitTopLevelBlocks(md.parse(content, env));

  if (changedLines.size > 0) {
    for (const block of blocks) {
      const open = block.tokens[0];
      if (open.map && rangeHasChange(open.map, changedLines)) {
        open.attrJoin("class", "md-changed");
      }
    }
  }

  // 削除は「直後のブロックの直前」に印を入れる。文末の削除は最後にまとめて置く。
  const beforeBlock = deletions.filter((d) => !d.atEnd).sort((a, b) => a.line - b.line);
  const atEndCount = deletions.length - beforeBlock.length;

  let html = "";
  let di = 0;
  for (const block of blocks) {
    while (di < beforeBlock.length && beforeBlock[di].line <= block.startLine) {
      html += removedMarkerHtml;
      di += 1;
    }
    html += md.renderer.render(block.tokens, md.options, env);
  }
  for (; di < beforeBlock.length; di += 1) {
    html += removedMarkerHtml;
  }
  for (let i = 0; i < atEndCount; i += 1) {
    html += removedMarkerHtml;
  }

  return html;
}

export default function MarkdownPreview({
  content,
  changedLines,
  deletions,
}: MarkdownPreviewProps) {
  const renderedHtml = useMemo(
    () => ({ __html: renderMarkdown(content, changedLines, deletions) }),
    [content, changedLines, deletions],
  );

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
    <div className="markdown-preview" onClick={handleClick}>
      <div className="markdown-preview-body" dangerouslySetInnerHTML={renderedHtml} />
    </div>
  );
}
