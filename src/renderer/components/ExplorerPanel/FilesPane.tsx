import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist";
import type { FileTreeNode, GitFileStatus, GitPathState } from "../../../shared/ipc";
import type { PreviewSelection } from "../../types";
import {
  buildIgnoredPathSet,
  buildTreeStatusMap,
  treeStatusClass,
} from "../../utils/git";
import { resultDataOrNull } from "../../utils/result";
import {
  collectAncestorDirectories,
  collectDirectoryPaths,
  normalizeExpandedDirectories,
  replaceNodeChildren,
} from "./fileTree";

interface FilesPaneProps {
  changedFiles: readonly GitFileStatus[];
  gitPathStates: readonly GitPathState[];
  height: number;
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
  sessionId: string;
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((path, index) => path === right[index]);
}

function filterEffectivelyExpandedDirectories(relativePaths: readonly string[]): string[] {
  const openPaths = new Set(relativePaths);
  return relativePaths.filter((relativePath) => {
    const segments = relativePath.split("/");
    for (let i = 1; i < segments.length; i++) {
      if (!openPaths.has(segments.slice(0, i).join("/"))) {
        return false;
      }
    }
    return true;
  });
}

export function FilesPane({
  changedFiles,
  gitPathStates,
  height,
  onPreviewSelectionChange,
  previewSelection,
  sessionId,
}: FilesPaneProps) {
  const [treeData, setTreeData] = useState<FileTreeNode[]>([]);
  const [, setExpandedDirectories] = useState<string[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(new Set());
  const treeDataRef = useRef<FileTreeNode[]>([]);
  const expandedDirectoriesRef = useRef<string[]>([]);
  const loadedDirectoriesRef = useRef<Set<string>>(new Set());
  const loadingDirectoriesRef = useRef<Set<string>>(new Set());
  const treeRef = useRef<TreeApi<FileTreeNode> | undefined>(undefined);
  const treeStatusByPath = buildTreeStatusMap(gitPathStates);
  const treeIgnoredPaths = buildIgnoredPathSet(gitPathStates);

  const syncWatchTargets = useCallback(
    (relativePaths: readonly string[]): void => {
      const nextTargets = relativePaths.length === 0 ? [] : ["", ...relativePaths];
      void window.electronAPI.syncFileWatchTargets(sessionId, nextTargets);
    },
    [sessionId],
  );

  const resetFilesState = useCallback((): void => {
    treeDataRef.current = [];
    expandedDirectoriesRef.current = [];
    loadedDirectoriesRef.current = new Set();
    loadingDirectoriesRef.current = new Set();
    setTreeData([]);
    setExpandedDirectories([]);
    setLoadingDirectories(loadingDirectoriesRef.current);
  }, []);

  const commitExpandedDirectories = useCallback(
    (nextExpandedDirectories: readonly string[], nextTreeData?: FileTreeNode[]): string[] => {
      const normalized = normalizeExpandedDirectories(
        Array.from(nextExpandedDirectories).sort((a, b) => a.localeCompare(b)),
        nextTreeData ?? treeDataRef.current,
      );

      if (!samePaths(expandedDirectoriesRef.current, normalized)) {
        expandedDirectoriesRef.current = normalized;
        setExpandedDirectories(normalized);
      }

      syncWatchTargets(normalized);
      return normalized;
    },
    [syncWatchTargets],
  );

  const applyTreeUpdate = useCallback(
    (relativePath: string, nextNodes: FileTreeNode[]): void => {
      const nextTreeData =
        relativePath.length > 0
          ? replaceNodeChildren(treeDataRef.current, relativePath, nextNodes)
          : nextNodes;
      const validDirectoryPaths = collectDirectoryPaths(nextTreeData);
      const nextLoadedDirectories = new Set<string>([""]);
      for (const loadedPath of loadedDirectoriesRef.current) {
        if (loadedPath === "" || validDirectoryPaths.has(loadedPath)) {
          nextLoadedDirectories.add(loadedPath);
        }
      }

      treeDataRef.current = nextTreeData;
      loadedDirectoriesRef.current = nextLoadedDirectories;
      setTreeData(nextTreeData);
      commitExpandedDirectories(expandedDirectoriesRef.current, nextTreeData);
    },
    [commitExpandedDirectories],
  );

  const loadDirectory = useCallback(
    async (relativePath = "", options?: { force?: boolean }): Promise<void> => {
      const force = options?.force ?? false;
      if (
        (!force && loadedDirectoriesRef.current.has(relativePath)) ||
        loadingDirectoriesRef.current.has(relativePath)
      ) {
        return;
      }

      loadingDirectoriesRef.current = new Set(loadingDirectoriesRef.current).add(relativePath);
      setLoadingDirectories(loadingDirectoriesRef.current);
      try {
        const result = await window.electronAPI.listFiles(sessionId, relativePath);
        const nextNodes = resultDataOrNull(result);
        if (!nextNodes) {
          return;
        }

        applyTreeUpdate(relativePath, nextNodes);
        loadedDirectoriesRef.current = new Set(loadedDirectoriesRef.current).add(relativePath);
      } finally {
        const nextLoadingDirectories = new Set(loadingDirectoriesRef.current);
        nextLoadingDirectories.delete(relativePath);
        loadingDirectoriesRef.current = nextLoadingDirectories;
        setLoadingDirectories(nextLoadingDirectories);
      }
    },
    [applyTreeUpdate, sessionId],
  );

  const syncExpandedDirectoriesFromTree = useCallback((): void => {
    if (!treeRef.current) {
      return;
    }

    const nextExpandedDirectories = Object.entries(treeRef.current.openState)
      .filter(([, isOpen]) => isOpen)
      .map(([path]) => path)
      .sort((a, b) => a.localeCompare(b));
    commitExpandedDirectories(filterEffectivelyExpandedDirectories(nextExpandedDirectories));
  }, [commitExpandedDirectories]);

  const revealChangedDirectories = useCallback(async (): Promise<void> => {
    const directoryPaths = collectAncestorDirectories(changedFiles.map((file) => file.path));

    await loadDirectory("");
    for (const directoryPath of directoryPaths) {
      await loadDirectory(directoryPath);
    }

    treeRef.current?.closeAll();
    for (const directoryPath of directoryPaths) {
      treeRef.current?.open(directoryPath);
    }
    commitExpandedDirectories(directoryPaths);
  }, [changedFiles, commitExpandedDirectories, loadDirectory]);

  const collapseAllDirectories = useCallback((): void => {
    treeRef.current?.closeAll();
    commitExpandedDirectories([]);
  }, [commitExpandedDirectories]);

  useEffect(() => {
    resetFilesState();
    commitExpandedDirectories([], []);
    void loadDirectory("");
  }, [commitExpandedDirectories, loadDirectory, resetFilesState, sessionId]);

  useEffect(() => {
    const dispose = window.electronAPI.onFileTreeChanged((changedSessionId, relativePath) => {
      if (changedSessionId !== sessionId) {
        return;
      }
      void loadDirectory(relativePath, { force: true });
    });

    return dispose;
  }, [loadDirectory, sessionId]);

  useEffect(() => {
    return () => {
      syncWatchTargets([]);
    };
  }, [syncWatchTargets]);

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
      <div className="file-tree">
        {loadingDirectories.has("") && treeData.length === 0 ? (
          <div className="empty-changes">Loading files...</div>
        ) : treeData.length === 0 ? (
          <div className="empty-changes">No files</div>
        ) : (
          <Tree<FileTreeNode>
            ref={treeRef}
            data={treeData}
            width="100%"
            height={height}
            rowHeight={28}
            indent={12}
            openByDefault={false}
            selection={previewSelection?.kind === "file" ? previewSelection.path : undefined}
            disableDrag
            disableEdit
            onActivate={(node) => {
              if (node.data.kind === "file") {
                onPreviewSelectionChange({ kind: "file", path: node.data.path });
              }
            }}
            onToggle={(path) => {
              void loadDirectory(path);
              syncExpandedDirectoriesFromTree();
            }}
          >
            {(props) => (
              <FileTreeRow
                {...props}
                ignoredPaths={treeIgnoredPaths}
                statusByPath={treeStatusByPath}
              />
            )}
          </Tree>
        )}
      </div>
    </>
  );
}

function FileTreeRow({
  dragHandle,
  ignoredPaths,
  node,
  statusByPath,
  style,
}: NodeRendererProps<FileTreeNode> & {
  ignoredPaths: ReadonlySet<string>;
  statusByPath: ReadonlyMap<string, string>;
}) {
  const isDirectory = node.data.kind === "directory";
  const statusClass = treeStatusClass(statusByPath.get(node.data.path));
  const isIgnored = ignoredPaths.has(node.data.path);

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`file-tree-row ${node.isSelected ? "selected" : ""}`}
      onClick={() => {
        if (isDirectory) {
          node.toggle();
        } else {
          node.select();
          node.activate();
        }
      }}
    >
      <span className={`file-tree-caret ${isDirectory ? "directory" : "file"}`}>
        {isDirectory ? (
          node.isOpen ? (
            <ChevronDown size={15} strokeWidth={2.4} />
          ) : (
            <ChevronRight size={15} strokeWidth={2.4} />
          )
        ) : null}
      </span>
      <span
        className={`file-tree-name ${node.data.kind} ${statusClass} ${isIgnored ? "ignored" : ""}`}
      >
        {node.data.name}
      </span>
    </div>
  );
}
