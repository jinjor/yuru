import type { RefObject } from "react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { AgentDefinition } from "../../shared/agent";
import type { GitPathState, Result, WorktreeSessionSelection } from "../../shared/ipc";
import type { WorktreeListItem } from "../../shared/metadata";
import type { TerminalRuntimeId } from "../../shared/session";
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
  sidebarWidth: number;
  worktree: WorktreeListItem | null;
  worktreeId: string;
  // session の開始・終了で変わる左ペインの dot / preview を更新するため、
  // App に repos の再取得を頼む。
  onSessionsChanged: () => void;
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
  sidebarWidth,
  worktree,
  worktreeId,
  onSessionsChanged,
}: SessionViewProps) {
  const sessionViewColumnRef = useRef<HTMLDivElement>(null);
  // この worktree でいま表示している terminal runtime。session 未開始や終了直後は null で、
  // その間 Terminal は session start surface を出す。
  const [terminalRuntimeId, setTerminalRuntimeId] = useState<TerminalRuntimeId | null>(
    () => worktree?.primarySession?.activeTerminalRuntimeId ?? null,
  );
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

  // resume / promote / 新規 session / standalone terminal 開始の共通処理。
  // 実行中は後続の開始操作を無視して、session や terminal の二重起動を防ぐ。
  // 完了前に別の worktree へ切り替えた場合はこの SessionView ごと unmount されるので、
  // 古い結果が表示を引き戻すことはない。
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
          return;
        }
        setTerminalRuntimeId(result.data.terminalRuntimeId);
        onSessionsChanged();
      } finally {
        isStartingRef.current = false;
      }
    },
    [onSessionsChanged],
  );

  useEffect(() => {
    return window.electronAPI.onTerminalRuntimeExited((exitedTerminalRuntimeId) => {
      setTerminalRuntimeId((prev) => (prev === exitedTerminalRuntimeId ? null : prev));
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
            onResumePrimarySession={(providerSessionKey) => {
              void startTerminalRuntime(() =>
                window.electronAPI.resumePrimarySession(worktreeId, providerSessionKey),
              );
            }}
            onResumeSuggestedSession={(providerSessionKey) => {
              void startTerminalRuntime(() =>
                window.electronAPI.resumeSuggestedSession(worktreeId, providerSessionKey),
              );
            }}
            onCreateSessionForWorktree={(provider) => {
              void startTerminalRuntime(() =>
                window.electronAPI.createSessionForWorktree(worktreeId, provider),
              );
            }}
            onOpenWorktreeTerminal={() => {
              void startTerminalRuntime(() => window.electronAPI.openWorktreeTerminal(worktreeId));
            }}
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
