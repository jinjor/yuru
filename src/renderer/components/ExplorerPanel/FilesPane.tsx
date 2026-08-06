import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FileTreeNode, GitFileStatus, GitPathState } from "../../../shared/ipc";
import type { PreviewSelection } from "../../types";
import { buildIgnoredPathSet, buildTreeStatusMap, treeStatusClass } from "../../utils/git";
import { resultDataOrNull } from "../../utils/result";
import {
  applyDirectoryListing,
  buildWatchTargets,
  buildVisibleTreeRows,
  collectAncestorDirectories,
  normalizeExpandedDirectories,
  removeDirectorySubtrees,
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
  worktreeId: string;
}

interface FilesCache {
  loadedDirectories: Set<string>;
  loadingDirectories: Set<string>;
  treeData: FileTreeNode[];
}

interface DirectoryLoad {
  promise: Promise<void>;
  reloadRequested: boolean;
}

function createEmptyFilesCache(): FilesCache {
  return {
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
  worktreeId,
}: FilesPaneProps) {
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set());
  const [filesCache, setFilesCache] = useState<FilesCache>(() => createEmptyFilesCache());
  const filesCacheRef = useRef<FilesCache>(filesCache);
  const directoryLoadsRef = useRef<Map<string, DirectoryLoad>>(new Map());
  const treeStatusByPath = buildTreeStatusMap(gitPathStates);
  const treeIgnoredPaths = buildIgnoredPathSet(gitPathStates);
  const { loadingDirectories, treeData } = filesCache;
  const visibleRows = buildVisibleTreeRows(treeData, expandedDirectories);

  const commitFilesCache = useCallback((nextFilesCache: FilesCache): void => {
    filesCacheRef.current = nextFilesCache;
    setFilesCache(nextFilesCache);
  }, []);

  const applyTreeUpdate = useCallback(
    (relativePath: string, nextNodes: FileTreeNode[]): void => {
      const prevCache = filesCacheRef.current;
      const update = applyDirectoryListing(prevCache.treeData, relativePath, nextNodes);
      commitFilesCache({
        ...prevCache,
        treeData: update.treeData,
        loadedDirectories: retainLoadedDirectories(
          new Set(prevCache.loadedDirectories).add(relativePath),
          update.treeData,
        ),
      });

      if (update.removedDirectoryPaths.length > 0) {
        setExpandedDirectories((prev) =>
          removeDirectorySubtrees(prev, update.removedDirectoryPaths),
        );
      }
    },
    [commitFilesCache],
  );

  const loadDirectory = useCallback(
    async (relativePath = ROOT_DIRECTORY_PATH, force = false): Promise<void> => {
      if (!force && filesCacheRef.current.loadedDirectories.has(relativePath)) {
        return;
      }

      const activeLoad = directoryLoadsRef.current.get(relativePath);
      if (activeLoad) {
        if (force) {
          activeLoad.reloadRequested = true;
        }
        return activeLoad.promise;
      }

      let directoryLoad: DirectoryLoad;
      const request = (async () => {
        const prevCache = filesCacheRef.current;
        commitFilesCache({
          ...prevCache,
          loadingDirectories: new Set(prevCache.loadingDirectories).add(relativePath),
        });
        const result = await window.electronAPI.listFiles(worktreeId, relativePath);
        if (directoryLoadsRef.current.get(relativePath) !== directoryLoad) {
          return;
        }

        const nextNodes = resultDataOrNull(result);
        if (!nextNodes) {
          return;
        }

        applyTreeUpdate(relativePath, nextNodes);
      })().finally(async () => {
        if (directoryLoadsRef.current.get(relativePath) !== directoryLoad) {
          return;
        }
        directoryLoadsRef.current.delete(relativePath);
        const prevCache = filesCacheRef.current;
        const nextLoadingDirectories = new Set(prevCache.loadingDirectories);
        nextLoadingDirectories.delete(relativePath);
        commitFilesCache({
          ...prevCache,
          loadingDirectories: nextLoadingDirectories,
        });
        if (directoryLoad.reloadRequested) {
          await loadDirectory(relativePath, true);
        }
      });

      directoryLoad = { promise: request, reloadRequested: false };
      directoryLoadsRef.current.set(relativePath, directoryLoad);
      return request;
    },
    [applyTreeUpdate, commitFilesCache, worktreeId],
  );

  const toggleDirectory = (relativePath: string): void => {
    const isOpen = expandedDirectories.has(relativePath);
    const nextExpandedDirectories = new Set(expandedDirectories);
    if (isOpen) {
      nextExpandedDirectories.delete(relativePath);
    } else {
      nextExpandedDirectories.add(relativePath);
    }
    setExpandedDirectories(nextExpandedDirectories);
    if (!isOpen) {
      void loadDirectory(relativePath);
    }
  };

  const revealChangedDirectories = async (): Promise<void> => {
    const directoryPaths = collectAncestorDirectories(changedFiles.map((file) => file.path));

    await loadDirectory(ROOT_DIRECTORY_PATH);
    for (const directoryPath of directoryPaths) {
      await loadDirectory(directoryPath);
    }

    setExpandedDirectories(
      normalizeExpandedDirectories(directoryPaths, filesCacheRef.current.treeData),
    );
  };

  const collapseAllDirectories = (): void => {
    setExpandedDirectories(new Set());
  };

  useEffect(() => {
    void window.electronAPI.syncFileWatchTargets(
      worktreeId,
      buildWatchTargets(expandedDirectories),
    );
  }, [expandedDirectories, worktreeId]);

  useEffect(() => {
    directoryLoadsRef.current = new Map();
    setExpandedDirectories(new Set());
    commitFilesCache(createEmptyFilesCache());
    void loadDirectory(ROOT_DIRECTORY_PATH);
  }, [commitFilesCache, loadDirectory]);

  useEffect(() => {
    const dispose = window.electronAPI.onFileTreeChanged((changedWorktreeId, relativePath) => {
      if (changedWorktreeId !== worktreeId) {
        return;
      }
      void loadDirectory(relativePath, true);
    });

    return dispose;
  }, [loadDirectory, worktreeId]);

  useEffect(() => {
    return () => {
      directoryLoadsRef.current = new Map();
      void window.electronAPI.syncFileWatchTargets(worktreeId, []);
    };
  }, [worktreeId]);

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
              isSelected={previewSelection?.path === row.node.path}
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
        onFileSelect({ path: node.path });
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
      <span className={`file-tree-name ${node.kind} ${statusClass} ${isIgnored ? "ignored" : ""}`}>
        {node.name}
        {isLoading ? "..." : ""}
      </span>
    </div>
  );
}
