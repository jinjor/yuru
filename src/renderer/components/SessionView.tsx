import type { RefObject } from "react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { GitDiffDocument, GitPathState } from "../../shared/ipc";
import type { GitHubPullRequest } from "../../shared/session";
import { DiffPreviewPanel } from "./DiffPreviewPanel";
import { ExplorerPanel, type ExplorerTab } from "./ExplorerPanel";
import { FileSearch } from "./FileSearch";
import { TerminalPanel } from "./TerminalPanel";
import { usePaneLayout } from "../hooks/usePaneLayout";
import type { PreviewSelection } from "../types";
import { resultDataOrNull } from "../utils/result";

interface SessionViewProps {
  appRef: RefObject<HTMLDivElement | null>;
  onOpenExternal: (url: string) => void;
  runtimeSessionId: string;
  sidebarWidth: number;
  worktreeId: string;
}

function isPathChanged(states: readonly GitPathState[], path: string): boolean {
  return states.some(
    (entry) => !entry.ignored && (entry.indexStatus || entry.worktreeStatus) && entry.path === path,
  );
}

export function SessionView({
  appRef,
  onOpenExternal,
  runtimeSessionId,
  sidebarWidth,
  worktreeId,
}: SessionViewProps) {
  const sessionViewColumnRef = useRef<HTMLDivElement>(null);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [diffDocument, setDiffDocument] = useState<GitDiffDocument | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [gitPathStates, setGitPathStates] = useState<GitPathState[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [currentGitHub, setCurrentGitHub] = useState<GitHubPullRequest | null>(null);
  const [isFileSearchOpen, setIsFileSearchOpen] = useState(false);
  const [explorerTab, setExplorerTab] = useState<ExplorerTab>("changes");
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const paneLayout = usePaneLayout({
    appRef,
    sidebarWidth,
    sessionViewColumnRef,
  });
  const previewPath = previewSelection?.path ?? null;
  const previewPathChanged = previewPath ? isPathChanged(gitPathStates, previewPath) : false;

  const resetPreviewState = useCallback((): void => {
    setPreviewSelection(null);
    setDiffDocument(null);
    setIsLoadingDiff(false);
  }, []);

  const handleFileLinkActivate = useCallback(
    async (filePath: string, line?: number): Promise<void> => {
      const repoRelativePath = await window.electronAPI.resolveRepoFile(worktreeId, filePath);
      if (!repoRelativePath) {
        return;
      }
      setPreviewSelection({ path: repoRelativePath, line });
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

    const fetchStatus = async (): Promise<void> => {
      const [pathStatesResult, branchContextResult] = await Promise.all([
        window.electronAPI.getGitPathStates(worktreeId),
        window.electronAPI.getGitBranchContext(worktreeId),
      ]);
      if (cancelled) {
        return;
      }

      setGitPathStates(resultDataOrNull(pathStatesResult) ?? []);
      const branchContext = resultDataOrNull(branchContextResult);
      setCurrentBranch(branchContext?.branch ?? null);
      setCurrentGitHub(branchContext?.github ?? null);
    };

    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [worktreeId]);

  useEffect(() => {
    if (!previewPath) {
      setDiffDocument(null);
      setIsLoadingDiff(false);
      return;
    }

    let cancelled = false;
    setIsLoadingDiff(true);

    const fetchDiff = async (showLoader: boolean): Promise<void> => {
      const result = await window.electronAPI.getGitDiffDocument(worktreeId, previewPath);
      if (cancelled) {
        return;
      }

      setDiffDocument(resultDataOrNull(result));
      if (showLoader) {
        setIsLoadingDiff(false);
      }
    };

    void fetchDiff(true);

    if (!previewPathChanged) {
      return () => {
        cancelled = true;
      };
    }

    const interval = setInterval(() => {
      void fetchDiff(false);
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [previewPath, previewPathChanged, worktreeId]);

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
            diffDocument={diffDocument}
            isLoading={isLoadingDiff}
            onClose={resetPreviewState}
          />
        )}
        {previewSelection && (
          <div
            className="pane-resize-handle horizontal session-view-split-handle"
            onMouseDown={paneLayout.handlePreviewResizeStart}
            aria-hidden="true"
          />
        )}
        <TerminalPanel
          changesPanelWidth={paneLayout.changesPanelWidth}
          currentBranch={currentBranch}
          currentGitHub={currentGitHub}
          isPreviewOpen={previewSelection !== null}
          onFileLinkActivate={(filePath, line) => {
            void handleFileLinkActivate(filePath, line);
          }}
          onOpenExternal={onOpenExternal}
          previewRatio={paneLayout.previewRatio}
          runtimeSessionId={runtimeSessionId}
        />
      </div>
      {runtimeSessionId && (
        <>
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
            searchFocusRequest={searchFocusRequest}
            width={paneLayout.changesPanelWidth}
            worktreeId={worktreeId}
          />
        </>
      )}
      {runtimeSessionId && isFileSearchOpen && (
        <FileSearch
          onClose={() => setIsFileSearchOpen(false)}
          onSelectFile={(path) => setPreviewSelection({ path })}
          worktreeId={worktreeId}
        />
      )}
    </>
  );
}
