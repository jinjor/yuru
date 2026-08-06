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
  const expandedDirectoriesRef = useRef<Set<string>>(expandedDirectories);
  const [filesCache, setFilesCache] = useState<FilesCache>(() => createEmptyFilesCache());
  const filesCacheRef = useRef<FilesCache>(filesCache);
  const inFlightLoadsRef = useRef<Map<string, Promise<void>>>(new Map());
  const pendingForcedReloadsRef = useRef<Set<string>>(new Set());
  const sessionGenerationRef = useRef(0);
  const treeStatusByPath = buildTreeStatusMap(gitPathStates);
  const treeIgnoredPaths = buildIgnoredPathSet(gitPathStates);
  const { loadingDirectories, treeData } = filesCache;
  const visibleRows = buildVisibleTreeRows(treeData, expandedDirectories);

  const replaceExpandedDirectories = useCallback((nextDirectories: Set<string>): void => {
    expandedDirectoriesRef.current = nextDirectories;
    setExpandedDirectories(nextDirectories);
  }, []);

  const updateExpandedDirectories = useCallback(
    (updater: (prev: Set<string>) => Set<string>): void => {
      replaceExpandedDirectories(updater(expandedDirectoriesRef.current));
    },
    [replaceExpandedDirectories],
  );

  const replaceFilesCache = useCallback((nextFilesCache: FilesCache): void => {
    filesCacheRef.current = nextFilesCache;
    setFilesCache(nextFilesCache);
  }, []);

  const updateFilesCache = useCallback(
    (updater: (prev: FilesCache) => FilesCache): void => {
      replaceFilesCache(updater(filesCacheRef.current));
    },
    [replaceFilesCache],
  );

  const syncWatchTargets = useCallback(
    (relativePaths: ReadonlySet<string>): void => {
      void window.electronAPI.syncFileWatchTargets(worktreeId, buildWatchTargets(relativePaths));
    },
    [worktreeId],
  );

  const applyTreeUpdate = useCallback(
    (relativePath: string, nextNodes: FileTreeNode[]): void => {
      const prevCache = filesCacheRef.current;
      const update = applyDirectoryListing(prevCache.treeData, relativePath, nextNodes);
      replaceFilesCache({
        ...prevCache,
        treeData: update.treeData,
        loadedDirectories: retainLoadedDirectories(
          new Set(prevCache.loadedDirectories).add(relativePath),
          update.treeData,
        ),
      });

      if (update.removedDirectoryPaths.length > 0) {
        updateExpandedDirectories((prev) =>
          removeDirectorySubtrees(prev, update.removedDirectoryPaths),
        );
      }
    },
    [replaceFilesCache, updateExpandedDirectories],
  );

  const loadDirectory = useCallback(
    async (relativePath = ROOT_DIRECTORY_PATH, force = false): Promise<void> => {
      if (!force && filesCacheRef.current.loadedDirectories.has(relativePath)) {
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
        updateFilesCache((prev) => ({
          ...prev,
          loadingDirectories: new Set(prev.loadingDirectories).add(relativePath),
        }));
        const result = await window.electronAPI.listFiles(worktreeId, relativePath);
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
          updateFilesCache((prev) => {
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
    [applyTreeUpdate, updateFilesCache, worktreeId],
  );

  const toggleDirectory = useCallback(
    (relativePath: string): void => {
      const isOpen = expandedDirectoriesRef.current.has(relativePath);
      updateExpandedDirectories((prev) => {
        const nextExpandedDirectories = new Set(prev);
        if (isOpen) {
          nextExpandedDirectories.delete(relativePath);
        } else {
          nextExpandedDirectories.add(relativePath);
        }
        return nextExpandedDirectories;
      });
      if (!isOpen) {
        void loadDirectory(relativePath);
      }
    },
    [loadDirectory, updateExpandedDirectories],
  );

  const revealChangedDirectories = useCallback(async (): Promise<void> => {
    const directoryPaths = collectAncestorDirectories(changedFiles.map((file) => file.path));

    await loadDirectory(ROOT_DIRECTORY_PATH);
    for (const directoryPath of directoryPaths) {
      await loadDirectory(directoryPath);
    }

    replaceExpandedDirectories(
      normalizeExpandedDirectories(directoryPaths, filesCacheRef.current.treeData),
    );
  }, [changedFiles, loadDirectory, replaceExpandedDirectories]);

  const collapseAllDirectories = useCallback((): void => {
    replaceExpandedDirectories(new Set());
  }, [replaceExpandedDirectories]);

  useEffect(() => {
    syncWatchTargets(expandedDirectories);
  }, [expandedDirectories, syncWatchTargets]);

  useEffect(() => {
    sessionGenerationRef.current += 1;
    inFlightLoadsRef.current = new Map();
    pendingForcedReloadsRef.current = new Set();
    replaceExpandedDirectories(new Set());
    replaceFilesCache(createEmptyFilesCache());
    void loadDirectory(ROOT_DIRECTORY_PATH);
  }, [loadDirectory, replaceExpandedDirectories, replaceFilesCache]);

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
      sessionGenerationRef.current += 1;
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
