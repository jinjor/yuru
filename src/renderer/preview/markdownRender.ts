import MarkdownIt from "markdown-it";
import type { DiffHunk } from "./diffHunks";
import { extendMarkdownItWithFrontmatter } from "./markdownFrontmatter";

// html: false で生 HTML を埋め込ませない (エスケープする)。出力タグは markdown-it が生成する
// 安全なものだけになるので、renderer に innerHTML で流し込んでよい。
const md = new MarkdownIt({ html: false, linkify: true });
extendMarkdownItWithFrontmatter(md);

type MdToken = ReturnType<typeof md.parse>[number];

interface TopLevelBlock {
  // ブロックの現在行の範囲 (1-based, 両端含む)。
  startLine: number;
  endLine: number;
  tokens: MdToken[];
}

// トークン列をトップレベルのブロック単位に切り出す。変更マークも削除マーカーもこの粒度で扱う
// (リストや引用の入れ子は丸ごと 1 ブロック)。
function splitTopLevelBlocks(tokens: MdToken[]): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = [];
  let depth = 0;
  let current: MdToken[] | null = null;
  let startLine = 0;
  let endLine = 0;

  for (const token of tokens) {
    if (current === null) {
      current = [];
      // 開始トークンの map はブロック全体 (入れ子を含む) を覆う。0-based・終了排他なので
      // 1-based の両端含む範囲に直す。
      startLine = token.map ? token.map[0] + 1 : 0;
      endLine = token.map ? token.map[1] : 0;
    }
    current.push(token);

    if (token.nesting === 1) {
      depth += 1;
    } else if (token.nesting === -1) {
      depth -= 1;
    }

    if (depth === 0) {
      blocks.push({ startLine, endLine, tokens: current });
      current = null;
    }
  }

  return blocks;
}

// hunk が現在の内容に残した行 (追加された行) が、このブロックに掛かっているか。
function hasAddedLinesIn(hunk: DiffHunk, block: TopLevelBlock): boolean {
  return (
    hunk.addedCount > 0 &&
    hunk.line <= block.endLine &&
    hunk.line + hunk.addedCount - 1 >= block.startLine
  );
}

const removedMarkerHtml = '<div class="md-removed" aria-label="lines removed"></div>';

// 現在の内容を HTML にしつつ、追加された行を含むブロックと削除された箇所に印を付ける。
export function renderMarkdown(content: string, hunks: readonly DiffHunk[]): string {
  const env = {};
  const blocks = splitTopLevelBlocks(md.parse(content, env));

  // 削除された行は現在の内容に残らないので、位置だけを示す。hunk は現在行の昇順に並んでいる。
  const removals = hunks.filter((hunk) => hunk.removedCount > 0 && !hunk.atEnd);
  // 文末の削除は指す行が無いので、最後にまとめて置く。
  const atEndCount = hunks.filter((hunk) => hunk.removedCount > 0 && hunk.atEnd).length;

  let html = "";
  let ri = 0;
  for (const block of blocks) {
    const open = block.tokens[0];
    // ブロックの間で起きた削除は、直後のブロックの前にマーカーを置く。
    while (ri < removals.length && removals[ri].line <= block.startLine) {
      html += removedMarkerHtml;
      ri += 1;
    }
    // ブロックの途中で起きた削除は、マーカーを割り込ませると HTML が壊れる (リストや表の中に
    // なる) ので、ブロック自体に印を付ける。追加もあるブロックには緑と赤の両方が付く。
    let removedInside = false;
    while (ri < removals.length && removals[ri].line <= block.endLine) {
      removedInside = true;
      ri += 1;
    }
    if (removedInside) {
      open.attrJoin("class", "md-removed-inside");
    }
    if (hunks.some((hunk) => hasAddedLinesIn(hunk, block))) {
      open.attrJoin("class", "md-changed");
    }
    html += md.renderer.render(block.tokens, md.options, env);
  }
  for (; ri < removals.length; ri += 1) {
    html += removedMarkerHtml;
  }
  for (let i = 0; i < atEndCount; i += 1) {
    html += removedMarkerHtml;
  }

  return html;
}
