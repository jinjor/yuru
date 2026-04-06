import { EditorView } from "codemirror";
import { Extension } from "@codemirror/state";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";

const customHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: "#569cd6" },
  { tag: [tags.string, tags.special(tags.string)], color: "#ce9178" },
  { tag: [tags.number, tags.bool, tags.null], color: "#b5cea8" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#6a9955" },
  { tag: [tags.className, tags.typeName], color: "#4ec9b0" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#dcdcaa" },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: "#9cdcfe" },
  { tag: [tags.operator, tags.operatorKeyword], color: "#d4d4d4" },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: "#808080" },
  { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], color: "#9cdcfe" },
]);

export const editorHighlighting = syntaxHighlighting(customHighlightStyle);

export const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#1e1e1e",
      color: "#d4d4d4",
    },
    ".cm-scroller": {
      fontFamily: "Menlo, Monaco, monospace",
      fontSize: "12px",
      lineHeight: "1.5",
    },
    ".cm-content": {
      caretColor: "#d4d4d4",
    },
    ".cm-lineNumbers": {
      color: "#666",
      backgroundColor: "#1a1a1a",
      borderRight: "1px solid #333",
      width: "5ch",
      minWidth: "5ch",
      maxWidth: "5ch",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      width: "100%",
      minWidth: "0",
      padding: "0 8px 0 0",
      boxSizing: "border-box",
      textAlign: "right",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
    },
    ".cm-activeLine": {
      backgroundColor: "transparent",
    },
    ".cm-selectionBackground": {
      backgroundColor: "#264f78 !important",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "#264f78",
    },
    ".cm-line::selection, .cm-line *::selection, .cm-content ::selection": {
      backgroundColor: "#264f78",
    },
    ".cm-gutters": {
      backgroundColor: "#1a1a1a",
      color: "#666",
      border: "none",
      flex: "0 0 auto",
    },
    "&.cm-merge-b .cm-changedLine, &.cm-merge-b .cm-inlineChangedLine": {
      backgroundColor: "rgba(46, 160, 67, 0.34)",
    },
    ".cm-insertedLine": {
      backgroundColor: "transparent",
      color: "inherit",
      textDecoration: "none",
    },
    ".cm-selectionMatch, .cm-selectionMatch-main": {
      backgroundColor: "transparent !important",
    },
    ".cm-deletedChunk": {
      backgroundColor: "rgba(255, 96, 88, 0.2)",
      paddingLeft: "0",
    },
    ".cm-deletedChunk .cm-deletedLine": {
      backgroundColor: "transparent",
      padding: "0 2px 0 6px",
    },
    ".cm-deletedLine, .cm-deletedLine del": {
      backgroundColor: "transparent",
      color: "inherit",
      textDecoration: "none",
    },
  },
  { dark: true },
);

export async function loadLanguageExtension(
  filePath: string | null,
  fileSize: number | null,
): Promise<Extension> {
  if (!filePath || (fileSize ?? 0) > 250_000) {
    return [];
  }

  const description = LanguageDescription.matchFilename(languages, filePath);
  if (!description) {
    return [];
  }

  try {
    const support = await description.load();
    return support.extension;
  } catch {
    return [];
  }
}
