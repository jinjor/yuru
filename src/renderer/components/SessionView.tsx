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
  currentBranch: string | null;
  currentGitHub: GitHubPullRequest | null;
  onOpenExternal: (url: string) => void;
  terminalRuntimeId: string;
  sidebarWidth: number;
  worktreeId: string;
}

function isPathChanged(states: readonly GitPathState[], path: string): boolean {
  return states.some(
    (entry) => !entry.ignored && (entry.indexStatus || entry.worktreeStatus) && entry.path === path,
  );
}

function isPageVisible(): boolean {
  return document.visibilityState === "visible";
}

export function SessionView({
  appRef,
  currentBranch,
  currentGitHub,
  onOpenExternal,
  terminalRuntimeId,
  sidebarWidth,
  worktreeId,
}: SessionViewProps) {
  const sessionViewColumnRef = useRef<HTMLDivElement>(null);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [diffDocument, setDiffDocument] = useState<GitDiffDocument | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [gitPathStates, setGitPathStates] = useState<GitPathState[]>([]);
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

    const fetchPathStates = async (): Promise<void> => {
      const pathStatesResult = await window.electronAPI.getGitPathStates(worktreeId);
      if (cancelled) {
        return;
      }

      setGitPathStates(resultDataOrNull(pathStatesResult) ?? []);
    };

    void fetchPathStates();

    const interval = setInterval(() => {
      if (!isPageVisible()) {
        return;
      }

      void fetchPathStates();
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
      if (!isPageVisible()) {
        return;
      }

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
          terminalRuntimeId={terminalRuntimeId}
        />
      </div>
      {terminalRuntimeId && (
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
      {terminalRuntimeId && isFileSearchOpen && (
        <FileSearch
          onClose={() => setIsFileSearchOpen(false)}
          onSelectFile={(path) => setPreviewSelection({ path })}
          worktreeId={worktreeId}
        />
      )}
    </>
  );
}
