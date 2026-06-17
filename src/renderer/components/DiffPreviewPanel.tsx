import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { diffArrays } from "diff";
import type { GitDiffDocument, GitDiffScope, GitLineStat } from "../../shared/ipc";
import type { FileViewMode } from "../types";
import { computeLineChanges } from "./CodeEditor/lineChanges";
import { SourceViewer, type SourceLine } from "./SourceViewer";
import { tokenizeCode, type TokenizedLine } from "../highlight";
import { PreviewHeader } from "./PreviewHeader";
import { resultDataOrNull } from "../utils/result";

const EditModeEditor = lazy(() => import("./CodeEditor/EditModeEditor"));

function isPageVisible(): boolean {
  return document.visibilityState === "visible";
}

interface DiffPreviewPanelProps {
  line?: number;
  onClose: () => void;
  path: string;
  // Changes pane から選んだ時だけ入る scope。なしは HEAD ↔ 作業ツリーの合算 diff。
  scope?: GitDiffScope;
  worktreeId: string;
  // 変更ありのファイルだけ diff をポーリングするための判定。git status は親が持つ。
  pathChanged: boolean;
}

export function DiffPreviewPanel({
  line,
  onClose,
  path,
  scope,
  worktreeId,
  pathChanged,
}: DiffPreviewPanelProps) {
  const [diffDocument, setDiffDocument] = useState<GitDiffDocument | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [lines, setLines] = useState<SourceLine[]>([]);
  const [mode, setMode] = useState<FileViewMode>("view");

  // ファイルが変わったら閲覧モードに戻す。パネルは再マウントしたくない (前の diff を出し続けて
  // チラつきを防ぐため key にしていない) ので、effect ではなく描画中に直接調整する React の方式。
  const [prevPath, setPrevPath] = useState(path);
  if (path !== prevPath) {
    setPrevPath(path);
    setMode("view");
  }

  // While a new file's diff is being fetched, `diffDocument` still holds the
  // previously shown file. Render it (with its own path) until the new diff
  // arrives so switching files does not flash a "Loading..." screen.
  const displayPath = diffDocument?.path ?? path;
  const originalContent = diffDocument?.originalContent ?? null;
  const currentContent = diffDocument?.currentContent ?? null;
  const fileSize = diffDocument?.size ?? null;
  const isBinary = diffDocument?.isBinary ?? false;
  const hasChanges = originalContent !== currentContent;

  // staged 差分は index を見ているので、作業ツリーを編集する編集モードには入れない。
  // (unstaged / Files から開いた時は current 側が作業ツリーなので編集に入れる)。実在チェックは
  // 編集に入った EditModeEditor が実ファイルを読んで行う (削除済みなら "missing")。
  const editDisabledReason = isBinary
    ? "Binary files cannot be edited"
    : scope === "staged"
      ? "Switch to the unstaged diff to edit"
      : undefined;
  const canEdit = diffDocument !== null && diffDocument.path === path && !editDisabledReason;
  const isEditing = mode === "edit" && canEdit;
  // ヘッダの +/- はポーリング中の diff から算出する (編集中の数値は autosave 後に追従する)。
  const headerLineStat = useMemo<GitLineStat>(
    () =>
      computeLineChanges((originalContent ?? "").split("\n"), (currentContent ?? "").split("\n"))
        .stat,
    [originalContent, currentContent],
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoadingDiff(true);

    const fetchDiff = async (showLoader: boolean): Promise<void> => {
      const result = await window.electronAPI.getGitDiffDocument(worktreeId, path, scope);
      if (cancelled) {
        return;
      }

      setDiffDocument(resultDataOrNull(result));
      if (showLoader) {
        setIsLoadingDiff(false);
      }
    };

    void fetchDiff(true);

    if (!pathChanged) {
      return () => {
        cancelled = true;
      };
    }

    const interval = setInterval(() => {
      if (!isPageVisible()) {
        return;
      }

      void fetchDiff(false);
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [path, scope, pathChanged, worktreeId]);

  useEffect(() => {
    let cancelled = false;

    if (originalContent === null && currentContent === null) {
      setLines([]);
      return;
    }

    const original = originalContent ?? "";
    const current = currentContent ?? "";

    Promise.all([
      tokenizeCode(original, displayPath, fileSize),
      tokenizeCode(current, displayPath, fileSize),
    ]).then(([originalTokenized, currentTokenized]) => {
      if (cancelled) {
        return;
      }

      const originalLines = original.split("\n");
      const currentLines = current.split("\n");
      setLines(computeDiffLines(originalTokenized, currentTokenized, originalLines, currentLines));
    });

    return () => {
      cancelled = true;
    };
  }, [currentContent, fileSize, originalContent, displayPath]);

  return (
    <div className="preview-panel">
      <PreviewHeader
        path={displayPath}
        mode={mode}
        onModeChange={setMode}
        canEdit={canEdit}
        editDisabledReason={editDisabledReason}
        lineStat={headerLineStat}
        onClose={onClose}
      />
      <div className="preview-body">
        {diffDocument === null ? (
          <div className="code-panel-empty">
            <p>{isLoadingDiff ? "Loading..." : "Preview is not available"}</p>
          </div>
        ) : isEditing ? (
          <Suspense
            fallback={
              <div className="code-panel-empty">
                <p>Loading editor…</p>
              </div>
            }
          >
            <EditModeEditor key={path} worktreeId={worktreeId} path={path} />
          </Suspense>
        ) : isBinary ? (
          <div className="code-panel-empty">
            <p>Binary preview is not available</p>
          </div>
        ) : (
          <SourceViewer
            lines={lines}
            className={hasChanges ? "diff-viewer" : ""}
            scrollToLine={diffDocument.path === path ? line : undefined}
          />
        )}
      </div>
    </div>
  );
}

function computeDiffLines(
  originalTokenized: TokenizedLine[],
  currentTokenized: TokenizedLine[],
  originalLines: string[],
  currentLines: string[],
): SourceLine[] {
  const changes = diffArrays(originalLines, currentLines);
  const result: SourceLine[] = [];
  let oldLineIndex = 0;
  let newLineIndex = 0;

  for (const change of changes) {
    if (change.removed) {
      for (let i = 0; i < change.count!; i++) {
        result.push({
          tokens: originalTokenized[oldLineIndex]?.tokens ?? [
            { content: originalLines[oldLineIndex] ?? "", color: "#d4d4d4", offset: 0 },
          ],
          lineNumber: undefined,
          className: "diff-deleted",
        });
        oldLineIndex++;
      }
      continue;
    }

    if (change.added) {
      for (let i = 0; i < change.count!; i++) {
        result.push({
          tokens: currentTokenized[newLineIndex]?.tokens ?? [
            { content: currentLines[newLineIndex] ?? "", color: "#d4d4d4", offset: 0 },
          ],
          lineNumber: newLineIndex + 1,
          className: "diff-added",
        });
        newLineIndex++;
      }
      continue;
    }

    for (let i = 0; i < change.count!; i++) {
      result.push({
        tokens: currentTokenized[newLineIndex]?.tokens ?? [
          { content: currentLines[newLineIndex] ?? "", color: "#d4d4d4", offset: 0 },
        ],
        lineNumber: newLineIndex + 1,
      });
      oldLineIndex++;
      newLineIndex++;
    }
  }

  return result;
}
