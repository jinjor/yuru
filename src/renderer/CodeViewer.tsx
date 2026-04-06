import { useEffect, useRef } from "react";
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState, Extension } from "@codemirror/state";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";

interface CodeViewerProps {
  content: string | null;
  filePath: string | null;
  fileSize: number | null;
  isLoading: boolean;
  isBinary: boolean;
}

const languageCompartment = new Compartment();

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

const editorTheme = EditorView.theme(
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
      backgroundColor: "#252526",
    },
    ".cm-activeLine": {
      backgroundColor: "#23252a",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "#264f78",
    },
    ".cm-gutters": {
      backgroundColor: "#1a1a1a",
      color: "#666",
      border: "none",
      flex: "0 0 auto",
    },
  },
  { dark: true },
);

async function loadLanguageExtension(filePath: string | null, fileSize: number | null): Promise<Extension> {
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

export function CodeViewer({
  content,
  filePath,
  fileSize,
  isLoading,
  isBinary,
}: CodeViewerProps): JSX.Element {
  const editorElementRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorElementRef.current || viewRef.current) {
      return;
    }

    const state = EditorState.create({
      doc: "",
      extensions: [
        basicSetup,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        editorTheme,
        syntaxHighlighting(customHighlightStyle),
        languageCompartment.of([]),
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: editorElementRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const updateEditor = async (): Promise<void> => {
      const view = viewRef.current;
      if (!view) {
        return;
      }

      const nextContent = content ?? "";
      const nextLanguage = await loadLanguageExtension(filePath, fileSize);
      if (cancelled || !viewRef.current) {
        return;
      }

      const currentView = viewRef.current;
      currentView.dispatch({
        changes: {
          from: 0,
          to: currentView.state.doc.length,
          insert: nextContent,
        },
        effects: languageCompartment.reconfigure(nextLanguage),
      });
      currentView.scrollDOM.scrollTop = 0;
      currentView.scrollDOM.scrollLeft = 0;
    };

    void updateEditor();

    return () => {
      cancelled = true;
    };
  }, [content, filePath, fileSize]);

  if (isLoading) {
    return (
      <div className="code-panel-empty">
        <p>Loading file...</p>
      </div>
    );
  }

  if (!filePath) {
    return (
      <div className="code-panel-empty">
        <p>Select a file to view code</p>
      </div>
    );
  }

  if (isBinary) {
    return (
      <div className="code-panel-empty">
        <p>Binary file preview is not available</p>
      </div>
    );
  }

  return <div ref={editorElementRef} className="code-editor" />;
}
