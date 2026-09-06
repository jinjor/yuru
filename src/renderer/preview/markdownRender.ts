import MarkdownIt from "markdown-it";
import { extendMarkdownItWithFrontmatter } from "./markdownFrontmatter";

// html: false で生 HTML を埋め込ませない (エスケープする)。出力タグは markdown-it が生成する
// 安全なものだけになるので、renderer に innerHTML で流し込んでよい。
const md = new MarkdownIt({ html: false, linkify: true });
extendMarkdownItWithFrontmatter(md);

type MdToken = ReturnType<typeof md.parse>[number];

export interface Deletion {
  // 削除直後の現在行 (1-based)。atEnd は文末での削除。
  line: number;
  atEnd: boolean;
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
      // 開始トークンの map はブロック全体 (入れ子を含む) を覆う。
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

const removedMarkerHtml = '<div class="md-removed" aria-label="lines removed"></div>';

// 現在の内容を HTML にしつつ、追加された行を含むブロックと削除された箇所に印を付ける。
export function renderMarkdown(
  content: string,
  changedLines: ReadonlySet<number>,
  deletions: readonly Deletion[],
): string {
  const env = {};
  const blocks = splitTopLevelBlocks(md.parse(content, env));

  // ブロックの間で起きた削除は「直後のブロックの直前」に印を入れる。文末の削除は最後にまとめて置く。
  const beforeBlock = deletions.filter((d) => !d.atEnd).sort((a, b) => a.line - b.line);
  const atEndCount = deletions.length - beforeBlock.length;

  let html = "";
  let di = 0;
  for (const block of blocks) {
    const open = block.tokens[0];
    while (di < beforeBlock.length && beforeBlock[di].line <= block.startLine) {
      html += removedMarkerHtml;
      di += 1;
    }
    // ブロックの途中で起きた削除は、印を割り込ませると HTML が壊れる (リストや表の中になる) ので、
    // ブロック自体に印を付ける。追加もあるブロックには緑と赤の両方が付く。
    let removedInside = false;
    while (di < beforeBlock.length && beforeBlock[di].line <= block.endLine) {
      removedInside = true;
      di += 1;
    }
    if (removedInside) {
      open.attrJoin("class", "md-removed-inside");
    }
    if (open.map && rangeHasChange(open.map, changedLines)) {
      open.attrJoin("class", "md-changed");
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
