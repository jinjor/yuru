import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// 閲覧側 (Shiki dark-plus) とテーマを寄せて、モード切替時の違和感を抑える。
const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "var(--text)",
      backgroundColor: "var(--viewer-bg)",
      fontSize: "12px",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.6",
      overflow: "auto",
    },
    ".cm-content": {
      caretColor: "var(--text)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--text)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "var(--viewer-selection)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--viewer-gutter)",
      color: "var(--text-subtle)",
      border: "none",
      borderRight: "1px solid rgba(255, 255, 255, 0.04)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 4px 0 8px",
      minWidth: "5ch",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--text-muted)",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(255, 255, 255, 0.03)",
    },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.self], color: "#569cd6" },
  { tag: [t.controlKeyword, t.moduleKeyword], color: "#c586c0" },
  { tag: [t.name, t.character, t.macroName], color: "#d4d4d4" },
  { tag: [t.propertyName, t.attributeName], color: "#9cdcfe" },
  { tag: [t.variableName], color: "#9cdcfe" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: "#dcdcaa" },
  { tag: [t.typeName, t.className, t.namespace], color: "#4ec9b0" },
  { tag: [t.string, t.special(t.string), t.escape], color: "#ce9178" },
  { tag: [t.number, t.bool, t.atom, t.null, t.constant(t.name)], color: "#b5cea8" },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: "#6a9955",
    fontStyle: "italic",
  },
  { tag: [t.tagName, t.angleBracket], color: "#569cd6" },
  { tag: [t.operator], color: "#d4d4d4" },
  { tag: [t.regexp], color: "#d16969" },
  { tag: [t.meta], color: "#9cdcfe" },
  { tag: [t.heading], color: "#569cd6", fontWeight: "bold" },
  { tag: [t.strong], fontWeight: "bold" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.link, t.url], color: "#9cdcfe", textDecoration: "underline" },
  { tag: [t.invalid], color: "var(--danger)" },
]);

export function editorThemeExtensions(): Extension {
  return [editorTheme, syntaxHighlighting(highlightStyle)];
}
