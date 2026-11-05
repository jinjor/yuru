import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { diffArrays } from "diff";
import { renderedPreviewKind } from "./renderedPreviewKind";
import type { GitDiffDocument, GitDiffScope, GitPathState } from "../../shared/ipc";
import { BlameAnnotation } from "./blame/BlameAnnotation";
import { useBlame } from "./blame/useBlame";
import { useCommitDetails } from "./blame/useCommitDetails";
import { computeDiffHunks } from "./diffHunks";
import { SourceViewer, type SourceLine } from "./SourceViewer";
import { tokenizeCode, type TokenizedLine } from "./highlight";
import type { FileViewMode } from "./fileViewMode";
import { startPollingLoop } from "../utils/polling";
import { resultDataOrNull } from "../utils/result";
import { EmptyState } from "../ui/EmptyState";

const EditModeEditor = lazy(() => import("./editor/EditModeEditor"));
const HtmlPreview = lazy(() => import("./HtmlPreview"));
const ImagePreview = lazy(() => import("./ImagePreview"));
const MarkdownPreview = lazy(() => import("./MarkdownPreview"));

interface TextDiffPreviewProps {
  mode: FileViewMode;
  headSha: string | null;
  line?: number;
  path: string;
  scope?: GitDiffScope;
  worktreeId: string;
  poll: boolean;
  gitPathState?: GitPathState;
}

export default function TextDiffPreview({
  mode,
  headSha,
  line,
  path,
  scope,
  worktreeId,
  poll,
  gitPathState,
}: TextDiffPreviewProps) {
  const [diffDocument, setDiffDocument] = useState<GitDiffDocument | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(true);
  const [tokenizedLines, setLines] = useState<SourceLine[]>([]);
  // blame を出す行。行指定で開いた行から始まりクリックで動く。行指定の強調表示とは別に持つ。
  // クリックした行はどこを開いていたときのものかと対で持ち、ファイル・scope・指定行が
  // 変わったら指定行に戻す。
  const openedLocation = JSON.stringify([path, scope ?? null, line ?? null]);
  const [clickedLine, setClickedLine] = useState<{ location: string; line: number } | null>(null);
  const focusedLine = clickedLine?.location === openedLocation ? clickedLine.line : line;
  const focusLine = (lineNumber: number): void => {
    setClickedLine({ location: openedLocation, line: lineNumber });
  };

  const displayPreviewKind = renderedPreviewKind(path);
  const originalContent = diffDocument?.originalContent ?? null;
  const currentContent = diffDocument?.currentContent ?? null;
  const lines = originalContent === null && currentContent === null ? [] : tokenizedLines;
  const fileSize = diffDocument?.size ?? null;
  const isBinary = diffDocument?.isBinary ?? false;
  const hasChanges = originalContent !== currentContent;

  const isExternalPath = path.startsWith("/");
  const isEditing = mode === "edit" && !isExternalPath && scope !== "base" && scope !== "staged";
  // Markdown プレビューの変更マーク。
  const diff = useMemo(
    () => computeDiffHunks((originalContent ?? "").split("\n"), (currentContent ?? "").split("\n")),
    [originalContent, currentContent],
  );

  // 本文に何を出すか。
  const body: "empty" | "edit" | "preview" | "binary" | "source" =
    diffDocument === null
      ? "empty"
      : isEditing
        ? "edit"
        : mode === "preview" && displayPreviewKind !== null
          ? "preview"
          : isBinary
            ? "binary"
            : "source";
  // worktree 外のファイルは git の履歴を持たないので、フォーカスも blame もしない。
  const canFocusLine = !isExternalPath;
  const blameLoad = useBlame({
    worktreeId,
    path,
    scope,
    enabled: body === "source" && canFocusLine && focusedLine !== undefined,
    currentContent,
    gitPathState,
    headSha,
  });
  const { commitDetails, requestCommitDetails } = useCommitDetails({ worktreeId, path, scope });

  useEffect(() => {
    let cancelled = false;
    // Activity の再表示を含め、最初の取得が完了するまでは loading とする。
    // oxlint-disable-next-line react/set-state-in-effect
    setIsLoadingDiff(true);
    let showLoader = true;

    const fetchDiff = async (): Promise<void> => {
      const result = await window.electronAPI.getGitDiffDocument(worktreeId, path, scope);
      if (cancelled) {
        return;
      }

      const document = resultDataOrNull(result);
      setDiffDocument(document);
      if (showLoader) {
        showLoader = false;
        setIsLoadingDiff(false);
      }
    };

    if (!poll) {
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
  }, [path, scope, poll, worktreeId]);

  useEffect(() => {
    let cancelled = false;

    if (originalContent === null && currentContent === null) {
      return;
    }

    const original = originalContent ?? "";
    const current = currentContent ?? "";

    Promise.all([
      tokenizeCode(original, path, fileSize),
      tokenizeCode(current, path, fileSize),
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
  }, [currentContent, fileSize, originalContent, path]);

  return (
    <>
      {body === "empty" ? (
        <EmptyState>{isLoadingDiff ? "Loading..." : "Preview is not available"}</EmptyState>
      ) : body === "edit" ? (
        <Suspense fallback={<EmptyState>Loading editor…</EmptyState>}>
          <EditModeEditor key={path} worktreeId={worktreeId} path={path} />
        </Suspense>
      ) : body === "preview" ? (
        <Suspense fallback={<EmptyState>Loading preview…</EmptyState>}>
          {displayPreviewKind === "html" ? (
            <HtmlPreview content={currentContent ?? ""} path={path} worktreeId={worktreeId} />
          ) : displayPreviewKind === "image" ? (
            // SVG はプレビューでは画像、閲覧・編集ではテキストとして扱う。
            <ImagePreview path={path} scope={scope} worktreeId={worktreeId} poll={poll} />
          ) : (
            <MarkdownPreview content={currentContent ?? ""} hunks={diff.hunks} />
          )}
        </Suspense>
      ) : body === "binary" ? (
        <EmptyState>Binary preview is not available</EmptyState>
      ) : (
        <SourceViewer
          lines={lines}
          className={hasChanges ? "diff-viewer" : ""}
          scrollToLine={line}
          focusedLine={canFocusLine ? focusedLine : undefined}
          onFocusLine={canFocusLine ? focusLine : undefined}
          focusedLineEnd={
            focusedLine === undefined ? null : (
              <BlameAnnotation
                load={blameLoad}
                commitDetails={commitDetails}
                onOpenCard={requestCommitDetails}
                lineNumber={focusedLine}
              />
            )
          }
        />
      )}
    </>
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
