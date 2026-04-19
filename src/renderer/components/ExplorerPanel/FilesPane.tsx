import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FileTreeNode, GitFileStatus, GitPathState } from "../../../shared/ipc";
import type { PreviewSelection } from "../../types";
import {
  buildIgnoredPathSet,
  buildTreeStatusMap,
  treeStatusClass,
} from "../../utils/git";
import { resultDataOrNull } from "../../utils/result";
import {
  buildWatchTargets,
  buildVisibleTreeRows,
  collectAncestorDirectories,
  normalizeExpandedDirectories,
  replaceNodeChildren,
  retainLoadedDirectories,
  ROOT_DIRECTORY_PATH,
  type VisibleTreeRow,
} from "./fileTree";

interface FilesPaneProps {
  changedFiles: readonly GitFileStatus[];
  gitPathStates: readonly GitPathState[];
  height: number;
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
  sessionId: string;
}

interface FilesState {
  expandedDirectories: Set<string>;
  loadedDirectories: Set<string>;
  loadingDirectories: Set<string>;
  treeData: FileTreeNode[];
}

function createEmptyFilesState(): FilesState {
  return {
    expandedDirectories: new Set(),
    loadedDirectories: new Set(),
    loadingDirectories: new Set(),
    treeData: [],
  };
}

export function FilesPane({
  changedFiles,
  gitPathStates,
  height,
  onPreviewSelectionChange,
  previewSelection,
  sessionId,
}: FilesPaneProps) {
  const [filesState, setFilesState] = useState<FilesState>(() => createEmptyFilesState());
  const filesStateRef = useRef<FilesState>(filesState);
  const inFlightLoadsRef = useRef<Map<string, Promise<void>>>(new Map());
  const pendingForcedReloadsRef = useRef<Set<string>>(new Set());
  const sessionGenerationRef = useRef(0);
  const treeStatusByPath = buildTreeStatusMap(gitPathStates);
  const treeIgnoredPaths = buildIgnoredPathSet(gitPathStates);
  const { expandedDirectories, loadingDirectories, treeData } = filesState;
  const visibleRows = buildVisibleTreeRows(treeData, expandedDirectories);

  const replaceFilesState = useCallback((nextFilesState: FilesState): void => {
    filesStateRef.current = nextFilesState;
    setFilesState(nextFilesState);
  }, []);

  const updateFilesState = useCallback((updater: (prev: FilesState) => FilesState): void => {
    setFilesState((prev) => {
      const next = updater(prev);
      filesStateRef.current = next;
      return next;
    });
  }, []);

  const syncWatchTargets = useCallback(
    (relativePaths: ReadonlySet<string>): void => {
      void window.electronAPI.syncFileWatchTargets(sessionId, buildWatchTargets(relativePaths));
    },
    [sessionId],
  );

  const applyTreeUpdate = useCallback((relativePath: string, nextNodes: FileTreeNode[]): void => {
    updateFilesState((prev) => {
      const nextTreeData =
        relativePath === ROOT_DIRECTORY_PATH
          ? nextNodes
          : replaceNodeChildren(prev.treeData, relativePath, nextNodes);

      return {
        ...prev,
        treeData: nextTreeData,
        loadedDirectories: retainLoadedDirectories(
          new Set(prev.loadedDirectories).add(relativePath),
          nextTreeData,
        ),
        expandedDirectories: normalizeExpandedDirectories(prev.expandedDirectories, nextTreeData),
      };
    });
  }, [updateFilesState]);

  const loadDirectory = useCallback(
    async (relativePath = ROOT_DIRECTORY_PATH, force = false): Promise<void> => {
      if (!force && filesStateRef.current.loadedDirectories.has(relativePath)) {
        return;
      }

      const inFlightLoad = inFlightLoadsRef.current.get(relativePath);
      if (inFlightLoad) {
        if (!force) {
          return inFlightLoad;
        }

        pendingForcedReloadsRef.current.add(relativePath);
        return inFlightLoad.finally(async () => {
          if (!pendingForcedReloadsRef.current.has(relativePath)) {
            return;
          }
          pendingForcedReloadsRef.current.delete(relativePath);
          await loadDirectory(relativePath, true);
        });
      }

      const generation = sessionGenerationRef.current;
      const request = (async () => {
        updateFilesState((prev) => ({
          ...prev,
          loadingDirectories: new Set(prev.loadingDirectories).add(relativePath),
        }));
        const result = await window.electronAPI.listFiles(sessionId, relativePath);
        if (sessionGenerationRef.current !== generation) {
          return;
        }

        const nextNodes = resultDataOrNull(result);
        if (!nextNodes) {
          return;
        }

        applyTreeUpdate(relativePath, nextNodes);
      })().finally(() => {
        inFlightLoadsRef.current.delete(relativePath);
        if (sessionGenerationRef.current === generation) {
          updateFilesState((prev) => {
            const nextLoadingDirectories = new Set(prev.loadingDirectories);
            nextLoadingDirectories.delete(relativePath);
            return {
              ...prev,
              loadingDirectories: nextLoadingDirectories,
            };
          });
        }
      });

      inFlightLoadsRef.current.set(relativePath, request);
      return request;
    },
    [applyTreeUpdate, sessionId, updateFilesState],
  );

  const toggleDirectory = useCallback(
    (relativePath: string): void => {
      const isOpen = filesStateRef.current.expandedDirectories.has(relativePath);
      updateFilesState((prev) => {
        const nextExpandedDirectories = new Set(prev.expandedDirectories);
        if (isOpen) {
          nextExpandedDirectories.delete(relativePath);
        } else {
          nextExpandedDirectories.add(relativePath);
        }
        return {
          ...prev,
          expandedDirectories: nextExpandedDirectories,
        };
      });
      if (!isOpen) {
        void loadDirectory(relativePath);
      }
    },
    [loadDirectory, updateFilesState],
  );

  const revealChangedDirectories = useCallback(async (): Promise<void> => {
    const directoryPaths = collectAncestorDirectories(changedFiles.map((file) => file.path));

    await loadDirectory(ROOT_DIRECTORY_PATH);
    for (const directoryPath of directoryPaths) {
      await loadDirectory(directoryPath);
    }

    updateFilesState((prev) => ({
      ...prev,
      expandedDirectories: normalizeExpandedDirectories(directoryPaths, prev.treeData),
    }));
  }, [changedFiles, loadDirectory, updateFilesState]);

  const collapseAllDirectories = useCallback((): void => {
    updateFilesState((prev) => ({
      ...prev,
      expandedDirectories: new Set(),
    }));
  }, [updateFilesState]);

  useEffect(() => {
    syncWatchTargets(expandedDirectories);
  }, [expandedDirectories, syncWatchTargets]);

  useEffect(() => {
    sessionGenerationRef.current += 1;
    inFlightLoadsRef.current = new Map();
    pendingForcedReloadsRef.current = new Set();
    replaceFilesState(createEmptyFilesState());
    void loadDirectory(ROOT_DIRECTORY_PATH);
  }, [loadDirectory, replaceFilesState, sessionId]);

  useEffect(() => {
    const dispose = window.electronAPI.onFileTreeChanged((changedSessionId, relativePath) => {
      if (changedSessionId !== sessionId) {
        return;
      }
      void loadDirectory(relativePath, true);
    });

    return dispose;
  }, [loadDirectory, sessionId]);

  useEffect(() => {
    return () => {
      sessionGenerationRef.current += 1;
      void window.electronAPI.syncFileWatchTargets(sessionId, []);
    };
  }, [sessionId]);

  return (
    <>
      <div className="panel-subactions">
        <span className="panel-subactions-label">Files</span>
        <div className="panel-header-actions">
          <button
            className="panel-header-action"
            onClick={() => {
              void revealChangedDirectories();
            }}
            disabled={changedFiles.length === 0}
            title="Expand only the directories that contain changed files"
          >
            Changed dirs
          </button>
          <button
            className="panel-header-action"
            onClick={collapseAllDirectories}
            disabled={treeData.length === 0}
            title="Collapse all directories"
          >
            Collapse all
          </button>
        </div>
      </div>
      <div className="file-tree" style={{ height }}>
        {loadingDirectories.has(ROOT_DIRECTORY_PATH) && treeData.length === 0 ? (
          <div className="empty-changes">Loading files...</div>
        ) : treeData.length === 0 ? (
          <div className="empty-changes">No files</div>
        ) : (
          visibleRows.map((row) => (
            <FileTreeRow
              key={row.node.id}
              isLoading={loadingDirectories.has(row.node.path)}
              ignoredPaths={treeIgnoredPaths}
              isSelected={
                previewSelection?.kind === "file" && previewSelection.path === row.node.path
              }
              onDirectoryToggle={toggleDirectory}
              onFileSelect={onPreviewSelectionChange}
              row={row}
              statusByPath={treeStatusByPath}
            />
          ))
        )}
      </div>
    </>
  );
}

function FileTreeRow({
  isLoading,
  ignoredPaths,
  isSelected,
  onDirectoryToggle,
  onFileSelect,
  row,
  statusByPath,
}: {
  isLoading: boolean;
  ignoredPaths: ReadonlySet<string>;
  isSelected: boolean;
  onDirectoryToggle: (path: string) => void;
  onFileSelect: (selection: PreviewSelection | null) => void;
  row: VisibleTreeRow;
  statusByPath: ReadonlyMap<string, string>;
}) {
  const { depth, isOpen, node } = row;
  const isDirectory = node.kind === "directory";
  const isIgnored = ignoredPaths.has(node.path);
  const statusClass = treeStatusClass(statusByPath.get(node.path));

  return (
    <div
      className={`file-tree-row ${isSelected ? "selected" : ""}`}
      onClick={() => {
        if (isDirectory) {
          onDirectoryToggle(node.path);
          return;
        }
        onFileSelect({ kind: "file", path: node.path });
      }}
      style={{ height: 28, paddingLeft: 12 + depth * 12 }}
    >
      <span className={`file-tree-caret ${isDirectory ? "directory" : "file"}`}>
        {isDirectory ? (
          isOpen ? (
            <ChevronDown size={15} strokeWidth={2.4} />
          ) : (
            <ChevronRight size={15} strokeWidth={2.4} />
          )
        ) : null}
      </span>
      <span
        className={`file-tree-name ${node.kind} ${statusClass} ${isIgnored ? "ignored" : ""}`}
      >
        {node.name}
        {isLoading ? "..." : ""}
      </span>
    </div>
  );
}
