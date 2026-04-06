import { useEffect, useRef, useState } from "react";
import { EditorView, minimalSetup } from "codemirror";
import { lineNumbers } from "@codemirror/view";
import { EditorState, Extension } from "@codemirror/state";
import { unifiedMergeView } from "@codemirror/merge";
import { editorHighlighting, editorTheme, loadLanguageExtension } from "./codeMirrorShared";

interface DiffViewerProps {
  originalContent: string | null;
  currentContent: string | null;
  filePath: string | null;
  fileSize: number | null;
  isLoading: boolean;
  isBinary: boolean;
}

function createDiffState(
  currentContent: string,
  originalContent: string,
  languageExtension: Extension,
): EditorState {
  return EditorState.create({
    doc: currentContent,
    extensions: [
      minimalSetup,
      lineNumbers(),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      editorTheme,
      editorHighlighting,
      languageExtension,
      unifiedMergeView({
        original: originalContent,
        highlightChanges: false,
        gutter: false,
        mergeControls: false,
        allowInlineDiffs: false,
        syntaxHighlightDeletions: true,
      }),
    ],
  });
}

export function DiffViewer({
  originalContent,
  currentContent,
  filePath,
  fileSize,
  isLoading,
  isBinary,
}: DiffViewerProps): JSX.Element {
  const editorElementRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const updateEditor = async (): Promise<void> => {
      const parent = editorElementRef.current;
      if (!parent) {
        return;
      }

      const nextLanguage = await loadLanguageExtension(filePath, fileSize);
      if (cancelled || !editorElementRef.current) {
        return;
      }

      try {
        viewRef.current?.destroy();
        viewRef.current = new EditorView({
          state: createDiffState(currentContent ?? "", originalContent ?? "", nextLanguage),
          parent,
        });
        setError(null);
      } catch (nextError) {
        console.error("Failed to initialize diff viewer", nextError);
        setError(nextError instanceof Error ? nextError.message : "Unknown diff viewer error");
      }
    };

    void updateEditor();

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [currentContent, filePath, fileSize, originalContent]);

  if (isLoading) {
    return (
      <div className="code-panel-empty">
        <p>Loading diff...</p>
      </div>
    );
  }

  if (!filePath) {
    return (
      <div className="code-panel-empty">
        <p>Select a file to view diff</p>
      </div>
    );
  }

  if (originalContent === null && currentContent === null) {
    return (
      <div className="code-panel-empty">
        <p>Diff preview is not available</p>
      </div>
    );
  }

  if (isBinary) {
    return (
      <div className="code-panel-empty">
        <p>Binary diff preview is not available</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="code-panel-empty">
        <p>Failed to render diff: {error}</p>
      </div>
    );
  }

  return <div ref={editorElementRef} className="code-editor diff-editor" />;
}
