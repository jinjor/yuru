import type { RefObject } from "react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { TreeApi } from "react-arborist";
import type {
  FileContent,
  FileTreeNode,
  GitDiffDocument,
  GitFileStatus,
} from "../../shared/ipc";
import type { GitHubPullRequest } from "../../shared/session";
import { DiffPreviewPanel } from "./DiffPreviewPanel";
import { ExplorerPanel } from "./ExplorerPanel";
import { FilePreviewPanel } from "./FilePreviewPanel";
import { TerminalPanel } from "./TerminalPanel";
import { usePaneLayout } from "../hooks/usePaneLayout";
import type { PreviewSelection } from "../types";
import { collectAncestorDirectories, replaceNodeChildren } from "../utils/fileTree";
import { resultDataOrNull } from "../utils/result";

interface WorkspaceProps {
  appRef: RefObject<HTMLDivElement | null>;
  isCreatingSession: boolean;
  onOpenExternal: (url: string) => void;
  refreshSessions: () => void;
  selectedId: string | null;
  sidebarWidth: number;
}

export function Workspace({
  appRef,
  isCreatingSession,
  onOpenExternal,
  refreshSessions,
  selectedId,
  sidebarWidth,
}: WorkspaceProps) {
  const workspaceColumnRef = useRef<HTMLDivElement>(null);
  const [changedFiles, setChangedFiles] = useState<GitFileStatus[]>([]);
  const [activeExplorerTab, setActiveExplorerTab] = useState<"changes" | "files">("changes");
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [diffDocument, setDiffDocument] = useState<GitDiffDocument | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [treeData, setTreeData] = useState<FileTreeNode[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(new Set());
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [currentGitHub, setCurrentGitHub] = useState<GitHubPullRequest | null>(null);
  const loadedDirectoriesRef = useRef<Set<string>>(new Set());
  const loadingDirectoriesRef = useRef<Set<string>>(new Set());
  const treeRef = useRef<TreeApi<FileTreeNode> | undefined>(undefined);
  const paneLayout = usePaneLayout({
    appRef,
    sidebarWidth,
    workspaceColumnRef,
  });

  const resetFileExplorerState = useCallback((): void => {
    setTreeData([]);
    loadedDirectoriesRef.current = new Set();
    loadingDirectoriesRef.current = new Set();
    setLoadingDirectories(loadingDirectoriesRef.current);
    setFileContent(null);
    setIsLoadingFile(false);
  }, []);

  const resetPreviewState = useCallback((): void => {
    setPreviewSelection(null);
    setDiffDocument(null);
    setIsLoadingDiff(false);
  }, []);

  const loadDirectory = useCallback(
    async (relativePath = ""): Promise<void> => {
      if (!selectedId) {
        return;
      }
      if (
        loadedDirectoriesRef.current.has(relativePath) ||
        loadingDirectoriesRef.current.has(relativePath)
      ) {
        return;
      }

      loadingDirectoriesRef.current = new Set(loadingDirectoriesRef.current).add(relativePath);
      setLoadingDirectories(loadingDirectoriesRef.current);
      try {
        const result = await window.electronAPI.listFiles(selectedId, relativePath);
        const nextNodes = resultDataOrNull(result);
        if (!nextNodes) {
          return;
        }

        setTreeData((prev) =>
          relativePath ? replaceNodeChildren(prev, relativePath, nextNodes) : nextNodes,
        );
        loadedDirectoriesRef.current = new Set(loadedDirectoriesRef.current).add(relativePath);
      } finally {
        const nextLoadingDirectories = new Set(loadingDirectoriesRef.current);
        nextLoadingDirectories.delete(relativePath);
        loadingDirectoriesRef.current = nextLoadingDirectories;
        setLoadingDirectories(nextLoadingDirectories);
      }
    },
    [selectedId],
  );

  const revealChangedDirectories = useCallback(async (): Promise<void> => {
    const directoryPaths = collectAncestorDirectories(changedFiles.map((file) => file.path));

    await loadDirectory("");
    for (const directoryPath of directoryPaths) {
      await loadDirectory(directoryPath);
    }

    requestAnimationFrame(() => {
      treeRef.current?.closeAll();
      for (const directoryPath of directoryPaths) {
        treeRef.current?.open(directoryPath);
      }
    });
  }, [changedFiles, loadDirectory]);

  const collapseAllDirectories = useCallback((): void => {
    treeRef.current?.closeAll();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setChangedFiles([]);
      resetPreviewState();
      setCurrentBranch(null);
      setCurrentGitHub(null);
      resetFileExplorerState();
      return;
    }

    let cancelled = false;
    const sessionId = selectedId;
    setCurrentBranch(null);
    setCurrentGitHub(null);
    setChangedFiles([]);

    const fetchStatus = async (): Promise<void> => {
      const [filesResult, branchContextResult] = await Promise.all([
        window.electronAPI.getGitStatus(sessionId),
        window.electronAPI.getGitBranchContext(sessionId),
      ]);
      if (cancelled) {
        return;
      }

      const files = resultDataOrNull(filesResult);
      if (files) {
        setChangedFiles((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(files)) {
            return prev;
          }
          return files;
        });
        setPreviewSelection((prev) => {
          if (prev?.kind === "diff" && !files.some((file) => file.path === prev.path)) {
            return null;
          }
          return prev;
        });
      }

      const branchContext = resultDataOrNull(branchContextResult);
      if (branchContext) {
        setCurrentBranch(branchContext.branch);
        setCurrentGitHub(branchContext.github);
      }

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
  }, [refreshSessions, resetFileExplorerState, resetPreviewState, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    resetFileExplorerState();
    void loadDirectory("");
  }, [loadDirectory, resetFileExplorerState, selectedId]);

  useEffect(() => {
    if (!selectedId || previewSelection?.kind !== "diff") {
      setDiffDocument(null);
      setIsLoadingDiff(false);
      return;
    }

    let cancelled = false;
    setIsLoadingDiff(true);

    const fetchDiff = async (showLoader: boolean): Promise<void> => {
      const result = await window.electronAPI.getGitDiffDocument(selectedId, previewSelection.path);
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
  }, [previewSelection, selectedId]);

  useEffect(() => {
    if (!selectedId || previewSelection?.kind !== "file") {
      setFileContent(null);
      setIsLoadingFile(false);
      return;
    }

    let cancelled = false;
    setIsLoadingFile(true);
    window.electronAPI.readFile(selectedId, previewSelection.path).then((result) => {
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
  }, [previewSelection, selectedId]);

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
            setActiveExplorerTab("files");
          }}
          onOpenExternal={onOpenExternal}
          selectedId={selectedId}
        />
      </div>
      {selectedId && (
        <>
          <div
            className="pane-resize-handle vertical"
            onMouseDown={paneLayout.handleChangesResizeStart}
            aria-hidden="true"
          />
          <ExplorerPanel
            activeTab={activeExplorerTab}
            onChangeTab={setActiveExplorerTab}
            files={changedFiles}
            onCollapseAllDirectories={collapseAllDirectories}
            onRevealChangedDirectories={() => {
              void revealChangedDirectories();
            }}
            selectedDiffFile={previewSelection?.kind === "diff" ? previewSelection.path : null}
            onSelectDiffFile={(filePath) => {
              setPreviewSelection({ kind: "diff", path: filePath });
            }}
            treeData={treeData}
            treeRef={treeRef}
            selectedTreeFile={previewSelection?.kind === "file" ? previewSelection.path : null}
            onSelectTreeFile={(filePath) => {
              setPreviewSelection({ kind: "file", path: filePath });
            }}
            onToggleDirectory={(path) => {
              void loadDirectory(path);
            }}
            treeLoading={loadingDirectories.has("")}
            width={paneLayout.changesPanelWidth}
          />
        </>
      )}
    </>
  );
}
