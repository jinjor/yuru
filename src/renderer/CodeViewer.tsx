import { useEffect, useRef } from "react";
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { editorHighlighting, editorTheme, loadLanguageExtension } from "./codeMirrorShared";

interface CodeViewerProps {
  content: string | null;
  filePath: string | null;
  fileSize: number | null;
  isLoading: boolean;
  isBinary: boolean;
}

const languageCompartment = new Compartment();

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
        editorHighlighting,
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
