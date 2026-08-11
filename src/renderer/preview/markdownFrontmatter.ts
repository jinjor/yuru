import MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import { parse, stringify } from "yaml";

const frontmatterTokenType = "frontmatter";
const marker = "---";

interface FrontmatterMeta {
  content: string;
}

export function extendMarkdownItWithFrontmatter(md: MarkdownIt): void {
  md.block.ruler.before("fence", frontmatterTokenType, parseFrontmatter, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  md.renderer.rules[frontmatterTokenType] = (tokens, index, _options, _env, renderer) => {
    const token = tokens[index];
    const meta = token.meta as FrontmatterMeta;
    return renderFrontmatter(meta.content, renderer.renderAttrs(token));
  };
}

function parseFrontmatter(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (startLine !== 0 || state.tShift[startLine] !== 0 || lineAt(state, startLine) !== marker) {
    return false;
  }

  let closingLine = startLine + 1;
  while (closingLine < endLine && lineAt(state, closingLine) !== marker) {
    closingLine += 1;
  }
  if (closingLine === endLine) {
    return false;
  }
  if (silent) {
    return true;
  }

  const contentStart = state.bMarks[startLine + 1];
  const contentEnd = state.bMarks[closingLine];
  const content = state.src.slice(contentStart, contentEnd).replace(/\n$/, "");
  const token = state.push(frontmatterTokenType, "", 0);
  token.block = true;
  token.map = [startLine, closingLine + 1];
  token.markup = marker;
  token.meta = { content } satisfies FrontmatterMeta;
  token.attrSet("class", "md-frontmatter");
  token.attrSet("aria-label", "Frontmatter");
  state.line = closingLine + 1;
  return true;
}

function lineAt(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line], state.eMarks[line]).trimEnd();
}

function renderFrontmatter(content: string, attrs: string): string {
  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<section${attrs}><div class="md-frontmatter-error" role="alert"><strong>Failed to parse frontmatter</strong><pre>${escapeHtml(message)}</pre></div></section>\n`;
  }

  const entries: [string, unknown][] =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.entries(parsed as Record<string, unknown>)
      : [["", parsed]];
  const rows = entries
    .map(
      ([key, value]) =>
        `<tr><th scope="row">${escapeHtml(key)}</th><td>${formatValue(value)}</td></tr>`,
    )
    .join("");
  return `<section${attrs}><table><tbody>${rows}</tbody></table></section>\n`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.length === 0
      ? ""
      : `<ul>${value.map((item) => `<li>${formatValue(item)}</li>`).join("")}</ul>`;
  }
  if (typeof value === "object") {
    return `<code>${escapeHtml(stringify(value).trimEnd())}</code>`;
  }
  return escapeHtml(String(value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
