import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { diffArrays } from "diff";
import type {
  GitDiffDocument,
  GitDiffScope,
  GitFileReviewUpdate,
  GitReviewLayer,
  GitReviewSnapshot,
} from "../../shared/ipc";
import type { FileViewMode } from "../types";
import { computeLineChanges } from "./CodeEditor/lineChanges";
import { SourceViewer, type SourceLine } from "./SourceViewer";
import { tokenizeCode, type TokenizedLine } from "../highlight";
import { PreviewHeader } from "./PreviewHeader";
import { startPollingLoop } from "../utils/polling";
import { resultDataOrNull } from "../utils/result";

const EditModeEditor = lazy(() => import("./CodeEditor/EditModeEditor"));
const HtmlPreview = lazy(() => import("./HtmlPreview"));
const MarkdownPreview = lazy(() => import("./MarkdownPreview"));

const markdownExtensions = new Set(["md", "markdown"]);
const htmlExtensions = new Set(["htm", "html"]);

type RenderedPreviewKind = "html" | "markdown";

function renderedPreviewKind(path: string): RenderedPreviewKind | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) {
    return null;
  }
  if (markdownExtensions.has(ext)) {
    return "markdown";
  }
  if (htmlExtensions.has(ext)) {
    return "html";
  }
  return null;
}

function reviewLayerForScope(scope: GitDiffScope | undefined): GitReviewLayer {
  return scope === "base" ? "head" : scope === "staged" ? "index" : "worktree";
}

interface DiffPreviewPanelProps {
  baseBranch?: string;
  line?: number;
  onClose: () => void;
  onReviewedChange: (
    reviewed: boolean,
    expectedSnapshot: GitReviewSnapshot,
  ) => Promise<GitFileReviewUpdate | null>;
  path: string;
  // Changes pane から選んだ時だけ入る scope。なしは HEAD ↔ 作業ツリーの合算 diff。
  scope?: GitDiffScope;
  worktreeId: string;
  // 変更ありのファイルだけ diff をポーリングするための判定。git status は親が持つ。
  pathChanged: boolean;
  reviewed?: boolean;
  reviewable: boolean;
}

export function DiffPreviewPanel({
  baseBranch,
  line,
  onClose,
  onReviewedChange,
  path,
  scope,
  worktreeId,
  pathChanged,
  reviewed,
  reviewable,
}: DiffPreviewPanelProps) {
  const [diffDocument, setDiffDocument] = useState<GitDiffDocument | null>(null);
  const [diffDocumentRequest, setDiffDocumentRequest] = useState<{
    path: string;
    scope?: GitDiffScope;
  } | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [isSettingReviewed, setIsSettingReviewed] = useState(false);
  const [diffRefreshVersion, setDiffRefreshVersion] = useState(0);
  const [lines, setLines] = useState<SourceLine[]>([]);
  // 描画できるファイルはプレビューを既定にし、それ以外は閲覧を既定にする。
  const hasRenderedPreview = renderedPreviewKind(path) !== null;
  const [mode, setMode] = useState<FileViewMode>(hasRenderedPreview ? "preview" : "view");

  // ファイルが変わったら既定モードに戻す。パネルは再マウントしたくない (前の diff を出し続けて
  // チラつきを防ぐため key にしていない) ので、effect ではなく描画中に直接調整する React の方式。
  const [prevPath, setPrevPath] = useState(path);
  if (path !== prevPath) {
    setPrevPath(path);
    setMode(hasRenderedPreview ? "preview" : "view");
  }

  // While a new file's diff is being fetched, `diffDocument` still holds the
  // previously shown file. Render it (with its own path) until the new diff
  // arrives so switching files does not flash a "Loading..." screen.
  const displayPath = diffDocument?.path ?? path;
  const displayPreviewKind = renderedPreviewKind(displayPath);
  const originalContent = diffDocument?.originalContent ?? null;
  const currentContent = diffDocument?.currentContent ?? null;
  const fileSize = diffDocument?.size ?? null;
  const isBinary = diffDocument?.isBinary ?? false;
  const hasChanges = originalContent !== currentContent;
  const isCurrentDocument =
    diffDocument?.path === path &&
    diffDocumentRequest?.path === path &&
    diffDocumentRequest.scope === scope;
  const activeReviewSnapshot =
    isCurrentDocument &&
    diffDocument?.reviewSnapshot?.path === path &&
    diffDocument.reviewSnapshot.layer === reviewLayerForScope(scope)
      ? diffDocument.reviewSnapshot
      : undefined;

  // staged 差分は index を見ているので、作業ツリーを編集する編集モードには入れない。
  // (unstaged / Files から開いた時は current 側が作業ツリーなので編集に入れる)。実在チェックは
  // 編集に入った EditModeEditor が実ファイルを読んで行う (削除済みなら "missing")。
  const editDisabledReason = isBinary
    ? "Binary files cannot be edited"
    : scope === "staged" || scope === "base"
      ? scope === "base"
        ? "Committed diffs cannot be edited"
        : "Switch to the unstaged diff to edit"
      : undefined;
  const canEdit = diffDocument !== null && isCurrentDocument && !editDisabledReason;
  const isEditing = mode === "edit" && canEdit;
  // reviewable は「この path に選択中 scope の差分があるか」を親が Git state から判定した値。
  // review state / snapshot の取得中もガワを維持し、差分のない Files 表示では出さない。
  const activeReviewed = reviewable ? (reviewed ?? false) : undefined;
  // ヘッダの +/- と、プレビューで変更ブロックに印を付けるための変更行を 1 回の計算から導く。
  // (編集中の数値は autosave 後に追従する)。
  const lineChanges = useMemo(
    () =>
      computeLineChanges((originalContent ?? "").split("\n"), (currentContent ?? "").split("\n")),
    [originalContent, currentContent],
  );
  const headerLineStat = lineChanges.stat;
  // プレビューは現在の内容を描画するので、追加 (緑) 側は行に印を付けられる。削除は中身を出せない
  // ので、純粋な削除箇所だけ位置マーカーとして渡す。
  const changedLines = useMemo(() => {
    const set = new Set<number>();
    for (const mark of lineChanges.marks) {
      if (mark.kind === "added") {
        set.add(mark.line);
      }
    }
    return set;
  }, [lineChanges]);
  const deletions = useMemo(
    () =>
      lineChanges.marks
        .filter((mark) => mark.kind === "deleted" || mark.kind === "deleted-end")
        .map((mark) => ({ line: mark.line, atEnd: mark.kind === "deleted-end" })),
    [lineChanges],
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoadingDiff(true);
    let showLoader = true;

    const fetchDiff = async (): Promise<void> => {
      const result = await window.electronAPI.getGitDiffDocument(worktreeId, path, scope);
      if (cancelled) {
        return;
      }

      setDiffDocument(resultDataOrNull(result));
      setDiffDocumentRequest({ path, scope });
      if (showLoader) {
        showLoader = false;
        setIsLoadingDiff(false);
      }
    };

    if (!pathChanged) {
      void fetchDiff();
      return () => {
        cancelled = true;
      };
    }

    const stopPolling = startPollingLoop(fetchDiff, 3000);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [diffRefreshVersion, path, scope, pathChanged, worktreeId]);

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
        baseBranch={scope === "base" && isCurrentDocument ? baseBranch : undefined}
        path={displayPath}
        mode={mode}
        onModeChange={setMode}
        showPreview={displayPreviewKind !== null}
        canEdit={canEdit}
        editDisabledReason={editDisabledReason}
        lineStat={headerLineStat}
        reviewed={activeReviewed}
        reviewPending={isSettingReviewed || reviewed === undefined || !activeReviewSnapshot}
        onReviewedChange={(nextReviewed) => {
          if (!activeReviewSnapshot) {
            return;
          }
          const expectedSnapshot = activeReviewSnapshot;
          setIsSettingReviewed(true);
          void onReviewedChange(nextReviewed, expectedSnapshot)
            .then((update) => {
              if (update?.kind === "stale") {
                setDiffDocumentRequest(null);
                setDiffRefreshVersion((version) => version + 1);
              }
            })
            .finally(() => setIsSettingReviewed(false));
        }}
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
        ) : mode === "preview" && displayPreviewKind !== null ? (
          <Suspense
            fallback={
              <div className="code-panel-empty">
                <p>Loading preview…</p>
              </div>
            }
          >
            {displayPreviewKind === "html" ? (
              <HtmlPreview
                content={currentContent ?? ""}
                path={displayPath}
                worktreeId={worktreeId}
              />
            ) : (
              <MarkdownPreview
                content={currentContent ?? ""}
                changedLines={changedLines}
                deletions={deletions}
              />
            )}
          </Suspense>
        ) : isBinary ? (
          <div className="code-panel-empty">
            <p>Binary preview is not available</p>
          </div>
        ) : (
          <SourceViewer
            lines={lines}
            className={hasChanges ? "diff-viewer" : ""}
            scrollToLine={isCurrentDocument ? line : undefined}
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
