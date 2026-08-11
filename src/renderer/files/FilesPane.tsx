import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FileTreeNode, GitFileStatus, GitPathState } from "../../shared/ipc";
import type { PreviewSelection } from "../previewSelection";
import { buildIgnoredPathSet, buildTreeStatusMap, treeStatusClass } from "../changes/gitStatus";
import { resultDataOrNull } from "../utils/result";
import {
  applyDirectoryListing,
  buildWatchTargets,
  buildVisibleTreeRows,
  collectAncestorDirectories,
  normalizeExpandedDirectories,
  removeDirectorySubtrees,
  ROOT_DIRECTORY_PATH,
  type VisibleTreeRow,
} from "./fileTree";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";

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
  token: object;
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
  const expandedDirectoriesRef = useRef(expandedDirectories);
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

  const commitExpandedDirectories = useCallback((nextExpandedDirectories: Set<string>): void => {
    expandedDirectoriesRef.current = nextExpandedDirectories;
    setExpandedDirectories(nextExpandedDirectories);
  }, []);

  const applyTreeUpdate = useCallback(
    (relativePath: string, nextNodes: FileTreeNode[]): void => {
      const prevCache = filesCacheRef.current;
      const update = applyDirectoryListing(prevCache.treeData, relativePath, nextNodes);
      if (!update) {
        return;
      }
      commitFilesCache({
        ...prevCache,
        treeData: update.treeData,
        loadedDirectories: removeDirectorySubtrees(
          new Set(prevCache.loadedDirectories).add(relativePath),
          update.removedDirectoryPaths,
        ),
      });

      if (update.removedDirectoryPaths.length > 0) {
        commitExpandedDirectories(
          removeDirectorySubtrees(expandedDirectoriesRef.current, update.removedDirectoryPaths),
        );
      }
    },
    [commitExpandedDirectories, commitFilesCache],
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

      const loadToken = {};
      const request = (async () => {
        const prevCache = filesCacheRef.current;
        commitFilesCache({
          ...prevCache,
          loadingDirectories: new Set(prevCache.loadingDirectories).add(relativePath),
        });
        const result = await window.electronAPI.listFiles(worktreeId, relativePath);
        if (directoryLoadsRef.current.get(relativePath)?.token !== loadToken) {
          return;
        }

        const nextNodes = resultDataOrNull(result);
        if (!nextNodes) {
          return;
        }

        applyTreeUpdate(relativePath, nextNodes);
      })().finally(async () => {
        const directoryLoad = directoryLoadsRef.current.get(relativePath);
        if (directoryLoad?.token !== loadToken) {
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

      const directoryLoad = { token: loadToken, promise: request, reloadRequested: false };
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
    commitExpandedDirectories(nextExpandedDirectories);
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

    commitExpandedDirectories(
      normalizeExpandedDirectories(directoryPaths, filesCacheRef.current.treeData),
    );
  };

  const collapseAllDirectories = (): void => {
    commitExpandedDirectories(new Set());
  };

  const reloadConnectedDirectories = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      const prevCache = filesCacheRef.current;
      if (prevCache.loadingDirectories.size > 0) {
        commitFilesCache({
          ...prevCache,
          loadingDirectories: new Set(),
        });
      }

      for (const relativePath of buildWatchTargets(expandedDirectoriesRef.current)) {
        if (signal.aborted) {
          return;
        }
        if (
          relativePath !== ROOT_DIRECTORY_PATH &&
          !expandedDirectoriesRef.current.has(relativePath)
        ) {
          continue;
        }
        await loadDirectory(relativePath, true);
      }
    },
    [commitFilesCache, loadDirectory],
  );

  useEffect(() => {
    void window.electronAPI.syncFileWatchTargets(
      worktreeId,
      buildWatchTargets(expandedDirectories),
    );
  }, [expandedDirectories, worktreeId]);

  useEffect(() => {
    const controller = new AbortController();
    void reloadConnectedDirectories(controller.signal);
    return () => {
      controller.abort();
    };
  }, [reloadConnectedDirectories]);

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
          <Button
            onClick={() => {
              void revealChangedDirectories();
            }}
            disabled={changedFiles.length === 0}
            title="Expand only the directories that contain changed files"
          >
            Changed dirs
          </Button>
          <Button
            onClick={collapseAllDirectories}
            disabled={treeData.length === 0}
            title="Collapse all directories"
          >
            Collapse all
          </Button>
        </div>
      </div>
      <div className="file-tree" style={{ height }}>
        {loadingDirectories.has(ROOT_DIRECTORY_PATH) && treeData.length === 0 ? (
          <EmptyState>Loading files...</EmptyState>
        ) : treeData.length === 0 ? (
          <EmptyState>No files</EmptyState>
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
