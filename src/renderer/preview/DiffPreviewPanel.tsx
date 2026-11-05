import { lazy, Suspense, useState } from "react";
import type { GitDiffScope, GitPathState, GitReviewState } from "../../shared/ipc";
import { getPreviewInfo } from "../../shared/preview";
import { buildIgnoredPathSet, isIgnoredPath } from "../changes/gitStatus";
import type { FileViewMode } from "./fileViewMode";
import { PreviewHeader } from "./PreviewHeader";
import { EmptyState } from "../ui/EmptyState";
import TextDiffPreview from "./TextDiffPreview";

const ImagePreview = lazy(() => import("./ImagePreview"));
const MediaPreview = lazy(() => import("./MediaPreview"));
const PdfPreview = lazy(() => import("./PdfPreview"));

function isPathChanged(states: readonly GitPathState[], path: string): boolean {
  return states.some(
    (entry) =>
      !entry.ignored &&
      (entry.conflicted || entry.indexStatus || entry.worktreeStatus) &&
      entry.path === path,
  );
}

function isPathChangedInScope(
  states: readonly GitPathState[],
  path: string,
  scope: "staged" | "unstaged" | undefined,
): boolean {
  const entry = states.find((state) => state.path === path);
  if (!entry || entry.ignored || entry.conflicted) {
    return false;
  }
  if (scope === "staged") {
    return Boolean(entry.indexStatus);
  }
  if (scope === "unstaged") {
    return Boolean(entry.worktreeStatus);
  }
  return Boolean(entry.indexStatus || entry.worktreeStatus);
}

interface DiffPreviewPanelProps {
  gitPathStates: readonly GitPathState[];
  headSha: string | null;
  line?: number;
  onClose: () => void;
  onReviewedChange: (
    path: string,
    scope: GitDiffScope | undefined,
    reviewed: boolean,
  ) => Promise<void>;
  path: string;
  reviewState: GitReviewState | null;
  // Changes pane から選んだ時だけ入る scope。なしは HEAD ↔ 作業ツリーの合算 diff。
  scope?: GitDiffScope;
  worktreeId: string;
}

export function DiffPreviewPanel({
  gitPathStates,
  headSha,
  line,
  onClose,
  onReviewedChange,
  path,
  reviewState,
  scope,
  worktreeId,
}: DiffPreviewPanelProps) {
  const [isSettingReviewed, setIsSettingReviewed] = useState(false);
  // 描画できるファイルはプレビューを既定にし、それ以外は閲覧を既定にする。
  const { kind: previewKind, isBinary: isBinaryPreview } = getPreviewInfo(path);
  const hasRenderedPreview = previewKind !== null;
  const [mode, setMode] = useState<FileViewMode>(hasRenderedPreview ? "preview" : "view");

  // ファイルが変わったら既定モードに戻す。
  const [prevPath, setPrevPath] = useState(path);
  if (path !== prevPath) {
    setPrevPath(path);
    setMode(hasRenderedPreview ? "preview" : "view");
  }

  // worktree 外のファイル (ターミナルリンク由来の絶対パス)。git state には載らず、
  // 編集モードも対象外 (worktree 内のファイルだけ書き込みを許す)。
  const isExternalPath = path.startsWith("/");
  const readyReviewState = reviewState?.kind === "ready" ? reviewState : null;
  const committedFile =
    scope === "base"
      ? readyReviewState?.committedFiles.find((file) => file.path === path)
      : undefined;
  const pathChanged =
    scope === "base" ? committedFile !== undefined : isPathChanged(gitPathStates, path);
  // 中身が動きうるファイルか。外部ファイルと gitignore されたファイルは、変化しても git status
  // に変更として載らず pathChanged が常に false なので、常に poll して追従する
  // (エージェントと話しながらメモを更新していく用途で使う)。
  // 各表示先に同じ更新条件を渡す。
  const shouldPollContent =
    pathChanged || isExternalPath || isIgnoredPath(path, buildIgnoredPathSet(gitPathStates));
  // staged 差分は index を見ているので、作業ツリーを編集する編集モードには入れない。
  // (unstaged / Files から開いた時は current 側が作業ツリーなので編集に入れる)。実在チェックは
  // 編集に入った EditModeEditor が実ファイルを読んで行う (削除済みなら "missing")。
  const editDisabledReason = isBinaryPreview
    ? "Binary files cannot be edited"
    : isExternalPath
      ? "Files outside the worktree cannot be edited"
      : scope === "staged" || scope === "base"
        ? scope === "base"
          ? "Committed diffs cannot be edited"
          : "Switch to the unstaged diff to edit"
        : undefined;
  // reviewable は「この path に選択中 scope の差分があるか」を Git state から判定した値。
  // review state / snapshot の取得中もガワを維持し、差分のない Files 表示では出さない。
  const reviewable =
    scope === "base"
      ? committedFile !== undefined
      : isPathChangedInScope(gitPathStates, path, scope);
  const workingCheck = readyReviewState?.workingChecks.find((check) => check.path === path);
  const reviewed =
    !readyReviewState || !reviewable
      ? undefined
      : scope === "base"
        ? committedFile?.reviewed
        : scope === "staged"
          ? workingCheck?.stagedReviewed
          : workingCheck?.unstagedReviewed;
  const activeReviewed = reviewable ? (reviewed ?? false) : undefined;
  const pathState = gitPathStates.find((state) => state.path === path);
  const lineStat = isBinaryPreview
    ? undefined
    : scope === "base"
      ? committedFile?.lineStat
      : scope === "staged"
        ? pathState?.stagedLineStat
        : scope === "unstaged"
          ? pathState?.unstagedLineStat
          : pathState?.conflicted
            ? pathState.conflictLineStat
            : pathState?.indexStatus && pathState.worktreeStatus
              ? pathState.combinedLineStat
              : (pathState?.stagedLineStat ?? pathState?.unstagedLineStat);
  const contentProps = { path, scope, worktreeId, poll: shouldPollContent };

  return (
    <div className="preview-panel">
      <PreviewHeader
        path={path}
        baseBranch={scope === "base" ? readyReviewState?.baseBranch : undefined}
        mode={mode}
        onModeChange={setMode}
        showPreview={hasRenderedPreview}
        canEdit={!editDisabledReason}
        editDisabledReason={editDisabledReason}
        lineStat={lineStat}
        reviewed={activeReviewed}
        reviewPending={isSettingReviewed || reviewed === undefined}
        onReviewedChange={(nextReviewed) => {
          setIsSettingReviewed(true);
          void onReviewedChange(path, scope, nextReviewed).finally(() =>
            setIsSettingReviewed(false),
          );
        }}
        onClose={onClose}
      />
      <div className="preview-body">
        <Suspense fallback={<EmptyState>Loading preview…</EmptyState>}>
          {isBinaryPreview ? (
            mode !== "preview" ? (
              <EmptyState>Binary preview is not available</EmptyState>
            ) : previewKind === "image" ? (
              <ImagePreview {...contentProps} />
            ) : previewKind === "pdf" ? (
              <PdfPreview key={JSON.stringify([worktreeId, path, scope])} {...contentProps} />
            ) : (
              <MediaPreview {...contentProps} />
            )
          ) : (
            <TextDiffPreview
              key={JSON.stringify([worktreeId, path, scope])}
              {...contentProps}
              mode={mode}
              headSha={headSha}
              line={line}
              gitPathState={pathState}
            />
          )}
        </Suspense>
      </div>
    </div>
  );
}
