import {
  memo,
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  AppError,
  GitPathState,
  GitReviewState,
  Result,
  WorktreeSessionSelection,
} from "../shared/ipc";
import type { WorktreeListItem } from "../shared/metadata";
import type { SessionProvider, TerminalRuntimeId } from "../shared/session";
import { DiffPreviewPanel } from "./preview/DiffPreviewPanel";
import { ExplorerPanel, type ExplorerTab } from "./explorer/ExplorerPanel";
import { FileSearch } from "./explorer/FileSearch";
import { TerminalBar } from "./terminal/TerminalBar";
import { TerminalPanel } from "./terminal/TerminalPanel";
import { TerminalSessionStart } from "./terminal/TerminalSessionStart";
import { usePaneLayout } from "./usePaneLayout";
import type { PreviewSelection } from "./previewSelection";
import { startPollingLoop } from "./utils/polling";
import { resultDataOrNull } from "./utils/result";

interface SessionViewProps {
  appRef: RefObject<HTMLDivElement | null>;
  onError: (error: AppError) => void;
  onOpenExternal: (url: string) => void;
  providers: SessionProvider[];
  sidebarWidth: number;
  worktree: WorktreeListItem | null;
  worktreeId: string;
  // session の開始・終了で変わる左ペインの dot / preview を更新するため、
  // App に repos の再取得を頼む。detach は取り直しの完了を待って表示を切り替えるので、
  // 再取得の完了で resolve する。
  onSessionsChanged: () => Promise<unknown>;
}

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

export const SessionView = memo(function SessionView({
  appRef,
  onError,
  onOpenExternal,
  providers,
  sidebarWidth,
  worktree,
  worktreeId,
  onSessionsChanged,
}: SessionViewProps) {
  // memo の実効性を E2E で固定するための、計測専用の意図的な render 副作用。
  // hidden 中は effect が動かないため、Step 3 の複数 instance 計測でも effect では代替できない。
  window.__yuruSessionViewRenderCounts ??= {};
  window.__yuruSessionViewRenderCounts[worktreeId] =
    (window.__yuruSessionViewRenderCounts[worktreeId] ?? 0) + 1;

  const sessionViewColumnRef = useRef<HTMLDivElement>(null);
  // この worktree で明示的に選んだ terminal runtime。null はホームを表す。
  const [selectedTerminalRuntimeId, setSelectedTerminalRuntimeId] =
    useState<TerminalRuntimeId | null>(null);
  const activeTerminalRuntimeIds = worktree?.activeTerminalRuntimeIds ?? [];
  // 選択した runtime が生きている間だけ表示する。fresh mount、ホーム選択、表示中 runtime
  // の exit はすべてホームになる。生死は props から導出するため hidden 中の exit も漏れない。
  const displayedTerminalRuntimeId =
    selectedTerminalRuntimeId && activeTerminalRuntimeIds.includes(selectedTerminalRuntimeId)
      ? selectedTerminalRuntimeId
      : null;
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [gitPathStates, setGitPathStates] = useState<GitPathState[]>([]);
  const [reviewState, setReviewState] = useState<GitReviewState | null>(null);
  const reviewMutationVersionRef = useRef(0);
  const [isFileSearchOpen, setIsFileSearchOpen] = useState(false);
  const [explorerTab, setExplorerTab] = useState<ExplorerTab>("changes");
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const paneLayout = usePaneLayout({
    appRef,
    sidebarWidth,
    sessionViewColumnRef,
  });
  const currentBranch = worktree?.branch ?? null;
  const currentGitHub = worktree?.githubPullRequest ?? null;
  const previewPath = previewSelection?.path ?? null;
  const committedPreviewFile =
    previewSelection?.scope === "base" && reviewState?.kind === "ready"
      ? reviewState.committedFiles.find((file) => file.path === previewSelection.path)
      : undefined;
  const previewPathChanged = previewPath
    ? previewSelection?.scope === "base"
      ? committedPreviewFile !== undefined
      : isPathChanged(gitPathStates, previewPath)
    : false;
  const workingReviewCheck =
    reviewState?.kind === "ready" && previewPath
      ? reviewState.workingChecks.find((check) => check.path === previewPath)
      : undefined;
  const previewHasReviewableChange = previewSelection
    ? previewSelection.scope === "base"
      ? committedPreviewFile !== undefined
      : isPathChangedInScope(gitPathStates, previewSelection.path, previewSelection.scope)
    : false;
  const previewReviewed =
    reviewState?.kind !== "ready" || !previewHasReviewableChange
      ? undefined
      : previewSelection?.scope === "base"
        ? committedPreviewFile?.reviewed
        : previewSelection?.scope === "staged"
          ? workingReviewCheck?.stagedReviewed
          : workingReviewCheck?.unstagedReviewed;
  const resetPreviewState = useCallback((): void => {
    setPreviewSelection(null);
  }, []);

  // resume / promote / 新規 session / standalone terminal 開始 / detach の共通ガード。
  // 実行中は後続の session 操作を無視して、二重起動や開始と解除の競合を防ぐ。
  // worktree ごとに instance が worktree の訪問中ずっと生きているため、hidden 中に完了した
  // 結果も自分自身にしか届かず、別の worktree の表示を引き戻さない。
  const isStartingRef = useRef(false);
  const startTerminalRuntime = useCallback(
    async (start: () => Promise<Result<WorktreeSessionSelection>>): Promise<void> => {
      if (isStartingRef.current) {
        return;
      }
      isStartingRef.current = true;
      try {
        const result = await start();
        if (!result.ok) {
          onError(result.error);
          return;
        }
        setSelectedTerminalRuntimeId(result.data.terminalRuntimeId);
        // repos が新しい runtime を含むまでは activeTerminalRuntimeIds 側に載っておらず
        // displayedTerminalRuntimeId が一時的に null (start surface) に戻る。ガードを
        // 外すのをここまで待つことで、その間の再クリックを無視して二重起動を防ぐ。
        await onSessionsChanged();
      } finally {
        isStartingRef.current = false;
      }
    },
    [onError, onSessionsChanged],
  );

  const detachPrimarySession = useCallback(
    async (agentSessionKey: string): Promise<void> => {
      if (isStartingRef.current) {
        return;
      }
      isStartingRef.current = true;
      try {
        const result = await window.electronAPI.detachPrimarySession(worktreeId, agentSessionKey);
        if (!result.ok) {
          return;
        }
        // 一覧を取り直すと worktree の primary が消え、Terminal は
        // 既存 / 新規 session の選択肢に切り替わる。resume と違い表示の切り替えを
        // この再取得だけに頼るので、完了までガードを保持して古い Resume / Detach への
        // 再操作を無視する。
        await onSessionsChanged();
      } finally {
        isStartingRef.current = false;
      }
    },
    [onSessionsChanged, worktreeId],
  );

  const killingTerminalRuntimeIdsRef = useRef(new Set<TerminalRuntimeId>());
  const killTerminalRuntime = useCallback(async (terminalRuntimeId: TerminalRuntimeId) => {
    if (killingTerminalRuntimeIdsRef.current.has(terminalRuntimeId)) {
      return;
    }
    killingTerminalRuntimeIdsRef.current.add(terminalRuntimeId);
    try {
      await window.electronAPI.killTerminalRuntime(terminalRuntimeId);
    } catch (error) {
      console.error("Failed to kill terminal runtime.", error);
    } finally {
      killingTerminalRuntimeIdsRef.current.delete(terminalRuntimeId);
    }
  }, []);

  useEffect(() => {
    return window.electronAPI.onTerminalRuntimeExited((exitedTerminalRuntimeId) => {
      setSelectedTerminalRuntimeId((prev) => (prev === exitedTerminalRuntimeId ? null : prev));
    });
  }, []);

  // main worktree は選択しただけで standalone terminal を開く (生きている runtime の再利用は
  // openWorktreeTerminal の IPC 側が行う)。terminal の exit 後に自動で開き直すことはせず、
  // session start surface の Open Terminal から開く。
  const isMainWorktree = worktree?.isMainWorktree === true;
  useEffect(() => {
    if (!isMainWorktree) {
      return;
    }
    void startTerminalRuntime(() => window.electronAPI.openWorktreeTerminal(worktreeId));
  }, [isMainWorktree, startTerminalRuntime, worktreeId]);

  const handleFileLinkActivate = useCallback(
    async (filePath: string, line?: number): Promise<void> => {
      // worktree 内なら相対パス、外なら絶対パスが返る (どちらもプレビューで開ける)。
      const resolvedPath = await window.electronAPI.resolveRepoFile(worktreeId, filePath);
      if (!resolvedPath) {
        return;
      }
      setPreviewSelection({ path: resolvedPath, line });
    },
    [worktreeId],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p";
      const isCodeSearchShortcut =
        (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f";
      if (!isPaletteShortcut && !isCodeSearchShortcut) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (isPaletteShortcut) {
        setIsFileSearchOpen((prev) => !prev);
        return;
      }
      setExplorerTab("search");
      setSearchFocusRequest((prev) => prev + 1);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchGitState = async (): Promise<void> => {
      const reviewMutationVersion = reviewMutationVersionRef.current;
      const [pathStatesResult, reviewStateResult] = await Promise.all([
        window.electronAPI.getGitPathStates(worktreeId),
        window.electronAPI.getReviewState(worktreeId),
      ]);
      if (cancelled) {
        return;
      }

      setGitPathStates(resultDataOrNull(pathStatesResult) ?? []);
      if (reviewMutationVersion === reviewMutationVersionRef.current) {
        setReviewState(resultDataOrNull(reviewStateResult));
      }
    };

    const stopPolling = startPollingLoop(fetchGitState, 3000);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [worktreeId]);

  const handleReviewedChange = useCallback(
    async (reviewed: boolean): Promise<void> => {
      if (!previewSelection) {
        return;
      }
      // 記録してから読み直すまでの間に返ってくる polling は、まだ古い状態を持っている。
      // version を進めておき、その結果で上書きされないようにする。
      const reviewMutationVersion = reviewMutationVersionRef.current + 1;
      reviewMutationVersionRef.current = reviewMutationVersion;
      const result = await window.electronAPI.setFileReviewed(
        worktreeId,
        previewSelection.path,
        previewSelection.scope,
        reviewed,
      );
      if (!result.ok) {
        return;
      }
      const nextReviewState = await window.electronAPI.getReviewState(worktreeId);
      if (nextReviewState.ok && reviewMutationVersion === reviewMutationVersionRef.current) {
        reviewMutationVersionRef.current += 1;
        setReviewState(nextReviewState.data);
      }
    },
    [previewSelection, worktreeId],
  );

  return (
    <>
      <div
        ref={sessionViewColumnRef}
        className={`session-view-column ${previewSelection ? "has-preview" : ""}`}
        style={
          previewSelection
            ? ({ "--preview-size": `${paneLayout.previewRatio * 100}%` } as CSSProperties)
            : undefined
        }
      >
        {previewSelection && (
          <DiffPreviewPanel
            path={previewSelection.path}
            line={previewSelection.line}
            scope={previewSelection.scope}
            pathChanged={previewPathChanged}
            baseBranch={
              previewSelection.scope === "base" && reviewState?.kind === "ready"
                ? reviewState.baseBranch
                : undefined
            }
            reviewed={previewReviewed}
            reviewable={previewHasReviewableChange}
            onReviewedChange={handleReviewedChange}
            onClose={resetPreviewState}
            worktreeId={worktreeId}
          />
        )}
        {previewSelection && (
          <div
            className="pane-resize-handle horizontal session-view-split-handle"
            onMouseDown={paneLayout.handlePreviewResizeStart}
            aria-hidden="true"
          />
        )}
        <main className="terminal-container">
          <TerminalBar
            activeTerminalRuntimeIds={activeTerminalRuntimeIds}
            currentBranch={currentBranch}
            currentGitHub={currentGitHub}
            primarySessions={worktree?.primarySessions ?? []}
            selectedTerminalRuntimeId={displayedTerminalRuntimeId}
            onKillTerminalRuntime={(terminalRuntimeId) => {
              void killTerminalRuntime(terminalRuntimeId);
            }}
            onOpenExternal={onOpenExternal}
            onSelectTerminalRuntime={setSelectedTerminalRuntimeId}
          />
          {displayedTerminalRuntimeId ? (
            <TerminalPanel
              key={displayedTerminalRuntimeId}
              changesPanelWidth={paneLayout.changesPanelWidth}
              isPreviewOpen={previewSelection !== null}
              onFileLinkActivate={(filePath, line) => {
                void handleFileLinkActivate(filePath, line);
              }}
              onOpenExternal={onOpenExternal}
              previewRatio={paneLayout.previewRatio}
              terminalRuntimeId={displayedTerminalRuntimeId}
            />
          ) : (
            <TerminalSessionStart
              providers={providers}
              worktree={worktree}
              onSelectPrimarySession={setSelectedTerminalRuntimeId}
              onResumePrimarySession={(agentSessionKey) => {
                void startTerminalRuntime(() =>
                  window.electronAPI.resumePrimarySession(worktreeId, agentSessionKey),
                );
              }}
              onDetachPrimarySession={(agentSessionKey) => {
                void detachPrimarySession(agentSessionKey);
              }}
              onResumeSuggestedSession={(agentSessionKey) => {
                void startTerminalRuntime(() =>
                  window.electronAPI.resumeSuggestedSession(worktreeId, agentSessionKey),
                );
              }}
              onCreateSessionForWorktree={(provider) => {
                void startTerminalRuntime(() =>
                  window.electronAPI.createSessionForWorktree(worktreeId, provider),
                );
              }}
              onOpenWorktreeTerminal={() => {
                void startTerminalRuntime(() =>
                  window.electronAPI.openWorktreeTerminal(worktreeId),
                );
              }}
            />
          )}
        </main>
      </div>
      <div
        className="pane-resize-handle vertical"
        onMouseDown={paneLayout.handleChangesResizeStart}
        aria-hidden="true"
      />
      <ExplorerPanel
        activeTab={explorerTab}
        gitPathStates={gitPathStates}
        onPreviewSelectionChange={setPreviewSelection}
        onTabChange={(tab) => {
          setExplorerTab(tab);
          if (tab === "search") {
            setSearchFocusRequest((prev) => prev + 1);
          }
        }}
        previewSelection={previewSelection}
        reviewState={reviewState}
        searchFocusRequest={searchFocusRequest}
        width={paneLayout.changesPanelWidth}
        worktreeId={worktreeId}
      />
      {isFileSearchOpen && (
        <FileSearch
          onClose={() => setIsFileSearchOpen(false)}
          onSelectFile={(path) => setPreviewSelection({ path })}
          worktreeId={worktreeId}
        />
      )}
    </>
  );
});
