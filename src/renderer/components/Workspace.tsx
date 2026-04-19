import type { RefObject } from "react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { GitDiffDocument, GitPathState } from "../../shared/ipc";
import type { GitHubPullRequest } from "../../shared/session";
import { DiffPreviewPanel } from "./DiffPreviewPanel";
import { ExplorerPanel } from "./ExplorerPanel";
import { TerminalPanel } from "./TerminalPanel";
import { usePaneLayout } from "../hooks/usePaneLayout";
import type { PreviewSelection } from "../types";
import { resultDataOrNull } from "../utils/result";

interface WorkspaceProps {
  appRef: RefObject<HTMLDivElement | null>;
  isCreatingSession: boolean;
  onOpenExternal: (url: string) => void;
  refreshSessions: () => void;
  sessionId: string | null;
  sidebarWidth: number;
}

function isPathChanged(states: readonly GitPathState[], path: string): boolean {
  return states.some(
    (entry) =>
      !entry.ignored && (entry.indexStatus || entry.worktreeStatus) && entry.path === path,
  );
}

export function Workspace({
  appRef,
  isCreatingSession,
  onOpenExternal,
  refreshSessions,
  sessionId,
  sidebarWidth,
}: WorkspaceProps) {
  const workspaceColumnRef = useRef<HTMLDivElement>(null);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [diffDocument, setDiffDocument] = useState<GitDiffDocument | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [gitPathStates, setGitPathStates] = useState<GitPathState[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [currentGitHub, setCurrentGitHub] = useState<GitHubPullRequest | null>(null);
  const paneLayout = usePaneLayout({
    appRef,
    sidebarWidth,
    workspaceColumnRef,
  });
  const previewPathChanged = previewSelection
    ? isPathChanged(gitPathStates, previewSelection.path)
    : false;

  const resetPreviewState = useCallback((): void => {
    setPreviewSelection(null);
    setDiffDocument(null);
    setIsLoadingDiff(false);
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setGitPathStates([]);
      setCurrentBranch(null);
      setCurrentGitHub(null);
      return;
    }

    let cancelled = false;

    const fetchStatus = async (): Promise<void> => {
      const [pathStatesResult, branchContextResult] = await Promise.all([
        window.electronAPI.getGitPathStates(sessionId),
        window.electronAPI.getGitBranchContext(sessionId),
      ]);
      if (cancelled) {
        return;
      }

      setGitPathStates(resultDataOrNull(pathStatesResult) ?? []);
      const branchContext = resultDataOrNull(branchContextResult);
      setCurrentBranch(branchContext?.branch ?? null);
      setCurrentGitHub(branchContext?.github ?? null);
      refreshSessions();
    };

    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshSessions, sessionId]);

  useEffect(() => {
    if (!sessionId || !previewSelection) {
      setDiffDocument(null);
      setIsLoadingDiff(false);
      return;
    }

    let cancelled = false;
    setIsLoadingDiff(true);

    const fetchDiff = async (showLoader: boolean): Promise<void> => {
      const result = await window.electronAPI.getGitDiffDocument(
        sessionId,
        previewSelection.path,
      );
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
  }, [previewPathChanged, previewSelection, sessionId]);

  return (
    <>
      <div
        ref={workspaceColumnRef}
        className={`workspace-column ${previewSelection ? "has-preview" : ""}`}
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
            className="pane-resize-handle horizontal workspace-split-handle"
            onMouseDown={paneLayout.handlePreviewResizeStart}
            aria-hidden="true"
          />
        )}
        <TerminalPanel
          currentBranch={currentBranch}
          currentGitHub={currentGitHub}
          fitDependencies={[
            paneLayout.changesPanelWidth,
            paneLayout.previewRatio,
            previewSelection,
          ]}
          isCreatingSession={isCreatingSession}
          onFileLinkActivate={(filePath, line) => {
            setPreviewSelection({ path: filePath, line });
          }}
          onOpenExternal={onOpenExternal}
          selectedId={sessionId}
        />
      </div>
      {sessionId && (
        <>
          <div
            className="pane-resize-handle vertical"
            onMouseDown={paneLayout.handleChangesResizeStart}
            aria-hidden="true"
          />
          <ExplorerPanel
            gitPathStates={gitPathStates}
            onPreviewSelectionChange={setPreviewSelection}
            previewSelection={previewSelection}
            sessionId={sessionId}
            width={paneLayout.changesPanelWidth}
          />
        </>
      )}
    </>
  );
}
