import { useEffect, useState } from "react";
import { resultDataOrNull } from "../../utils/result";
import CodeEditor from "./CodeEditor";

interface EditModeEditorProps {
  worktreeId: string;
  path: string;
}

interface EditorSeed {
  content: string;
  // ガターの基準 = index の内容 (unstaged diff の元側)。閲覧の scoped diff とは別物。
  base: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; seed: EditorSeed };

// 編集は常に作業ツリーの実ファイルが対象。閲覧の diff (scope 依存) を seed に使わず、
// 作業ツリー内容と unstaged base をバックエンドから取り直す。
export default function EditModeEditor({ worktreeId, path }: EditModeEditorProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void Promise.all([
      window.electronAPI.readWorktreeFile(worktreeId, path),
      window.electronAPI.getGitDiffDocument(worktreeId, path, "unstaged"),
    ]).then(([fileResult, diffResult]) => {
      if (cancelled) {
        return;
      }
      const content = resultDataOrNull(fileResult);
      if (content === null) {
        setState({ status: "missing" });
        return;
      }
      const base = resultDataOrNull(diffResult)?.originalContent ?? "";
      setState({ status: "ready", seed: { content, base } });
    });

    return () => {
      cancelled = true;
    };
  }, [worktreeId, path]);

  if (state.status === "loading") {
    return (
      <div className="code-panel-empty">
        <p>Loading…</p>
      </div>
    );
  }

  if (state.status === "missing") {
    return (
      <div className="code-panel-empty">
        <p>This file no longer exists in the worktree.</p>
      </div>
    );
  }

  return (
    <CodeEditor
      path={path}
      originalContent={state.seed.base}
      initialContent={state.seed.content}
      onSave={(content) => {
        void window.electronAPI.writeFile(worktreeId, path, content);
      }}
    />
  );
}
