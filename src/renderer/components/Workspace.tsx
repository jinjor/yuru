import type { RefObject } from "react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { BranchContext, FileContent, GitDiffDocument } from "../../shared/ipc";
import type { GitHubPullRequest } from "../../shared/session";
import { DiffPreviewPanel } from "./DiffPreviewPanel";
import { ExplorerPanel } from "./ExplorerPanel";
import { FilePreviewPanel } from "./FilePreviewPanel";
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
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [currentGitHub, setCurrentGitHub] = useState<GitHubPullRequest | null>(null);
  const paneLayout = usePaneLayout({
    appRef,
    sidebarWidth,
    workspaceColumnRef,
  });

  const resetPreviewState = useCallback((): void => {
    setPreviewSelection(null);
    setDiffDocument(null);
    setIsLoadingDiff(false);
  }, []);

  const handleBranchContextChange = useCallback((context: BranchContext): void => {
    setCurrentBranch(context.branch);
    setCurrentGitHub(context.github);
  }, []);

  useEffect(() => {
    if (sessionId) {
      return;
    }

    resetPreviewState();
    setFileContent(null);
    setIsLoadingFile(false);
    setCurrentBranch(null);
    setCurrentGitHub(null);
  }, [resetPreviewState, sessionId]);

  useEffect(() => {
    if (!sessionId || previewSelection?.kind !== "diff") {
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

      const diff = resultDataOrNull(result);
      setDiffDocument(diff);
      if (showLoader) {
        setIsLoadingDiff(false);
      }
    };

    void fetchDiff(true);
    const interval = setInterval(() => {
      void fetchDiff(false);
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [previewSelection, sessionId]);

  useEffect(() => {
    if (!sessionId || previewSelection?.kind !== "file") {
      setFileContent(null);
      setIsLoadingFile(false);
      return;
    }

    let cancelled = false;
    setIsLoadingFile(true);
    window.electronAPI.readFile(sessionId, previewSelection.path).then((result) => {
      if (cancelled) {
        return;
      }

      const nextContent = resultDataOrNull(result);
      setFileContent(nextContent);
      setIsLoadingFile(false);
    });

    return () => {
      cancelled = true;
    };
  }, [previewSelection, sessionId]);

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
        {previewSelection?.kind === "file" && (
          <FilePreviewPanel
            path={previewSelection.path}
            line={previewSelection.line}
            fileContent={fileContent}
            isLoading={isLoadingFile}
            onClose={resetPreviewState}
          />
        )}
        {previewSelection?.kind === "diff" && (
          <DiffPreviewPanel
            path={previewSelection.path}
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
            setPreviewSelection({ kind: "file", path: filePath, line });
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
            onBranchContextChange={handleBranchContextChange}
            onPreviewSelectionChange={setPreviewSelection}
            previewSelection={previewSelection}
            refreshSessions={refreshSessions}
            sessionId={sessionId}
            width={paneLayout.changesPanelWidth}
          />
        </>
      )}
    </>
  );
}
