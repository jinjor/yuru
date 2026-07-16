import type { RefObject } from "react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { AgentDefinition } from "../../shared/agent";
import type { GitPathState } from "../../shared/ipc";
import type { WorktreeListItem } from "../../shared/metadata";
import type { SessionProvider } from "../../shared/session";
import { DiffPreviewPanel } from "./DiffPreviewPanel";
import { ExplorerPanel, type ExplorerTab } from "./ExplorerPanel";
import { FileSearch } from "./FileSearch";
import { TerminalPanel } from "./TerminalPanel";
import { TerminalSessionStart } from "./TerminalSessionStart";
import { usePaneLayout } from "../hooks/usePaneLayout";
import type { PreviewSelection } from "../types";
import { startPollingLoop } from "../utils/polling";
import { resultDataOrNull } from "../utils/result";

interface SessionViewProps {
  appRef: RefObject<HTMLDivElement | null>;
  onOpenExternal: (url: string) => void;
  providers: AgentDefinition[];
  // 表示すべき terminal runtime がない間は null。その間 Terminal は session start surface を出す。
  terminalRuntimeId: string | null;
  sidebarWidth: number;
  worktree: WorktreeListItem | null;
  worktreeId: string;
  onResumePrimarySession: (worktreeId: string, providerSessionKey: string) => void;
  onResumeSuggestedSession: (worktreeId: string, providerSessionKey: string) => void;
  onCreateSessionForWorktree: (worktreeId: string, provider: SessionProvider) => void;
  onOpenWorktreeTerminal: (worktreeId: string) => void;
}

function isPathChanged(states: readonly GitPathState[], path: string): boolean {
  return states.some(
    (entry) =>
      !entry.ignored &&
      (entry.conflicted || entry.indexStatus || entry.worktreeStatus) &&
      entry.path === path,
  );
}

export function SessionView({
  appRef,
  onOpenExternal,
  providers,
  terminalRuntimeId,
  sidebarWidth,
  worktree,
  worktreeId,
  onResumePrimarySession,
  onResumeSuggestedSession,
  onCreateSessionForWorktree,
  onOpenWorktreeTerminal,
}: SessionViewProps) {
  const sessionViewColumnRef = useRef<HTMLDivElement>(null);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [gitPathStates, setGitPathStates] = useState<GitPathState[]>([]);
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
  const previewPathChanged = previewPath ? isPathChanged(gitPathStates, previewPath) : false;

  const resetPreviewState = useCallback((): void => {
    setPreviewSelection(null);
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

    const stopPolling = startPollingLoop(fetchPathStates, 3000);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [worktreeId]);

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
        {terminalRuntimeId ? (
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
        ) : (
          <TerminalSessionStart
            currentBranch={currentBranch}
            currentGitHub={currentGitHub}
            onOpenExternal={onOpenExternal}
            providers={providers}
            worktree={worktree}
            onResumePrimarySession={onResumePrimarySession}
            onResumeSuggestedSession={onResumeSuggestedSession}
            onCreateSessionForWorktree={onCreateSessionForWorktree}
            onOpenWorktreeTerminal={onOpenWorktreeTerminal}
          />
        )}
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
}
