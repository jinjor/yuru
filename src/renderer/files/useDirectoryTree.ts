import { useCallback, useEffect, useRef, useState } from "react";
import type { FileTreeNode } from "../../shared/ipc";
import {
  applyDirectoryListing,
  buildWatchTargets,
  buildVisibleTreeRows,
  collectAncestorDirectories,
  collectDirectoryPaths,
  normalizeExpandedDirectories,
  removeDirectorySubtrees,
  ROOT_DIRECTORY_PATH,
  type VisibleTreeRow,
} from "./fileTree";

// loading: ルートを読み込み中 / empty: ルートが空 / ready: 行がある / missing: ルートのディレクトリが無い。
export type DirectoryTreeStatus = "loading" | "empty" | "ready" | "missing";

// reveal で見せた行。同じパスの再表示でも、新しい要求としてスクロールさせるためにオブジェクトで持つ。
export interface DirectoryTreeRevealRequest {
  kind: "file" | "directory";
  path: string;
}

// ディスク上のディレクトリ 1 つを、ツリーとして表示し続けるための状態。
// 中身はディレクトリを開いたときに 1 段ずつ読み、開いているディレクトリを監視して読み直す。
// パスはすべてルートからの相対パス (ルート自身は "")。
export interface DirectoryTree {
  rows: VisibleTreeRow[];
  status: DirectoryTreeStatus;
  loadingDirectories: ReadonlySet<string>;
  revealRequest: DirectoryTreeRevealRequest | null;
  toggleDirectory: (path: string) => void;
  collapseAll: () => void;
  // 開いているディレクトリを、paths を見せるのに要るものだけにする。
  expandOnlyToShow: (paths: string[]) => Promise<void>;
  // 親まで開き、ディレクトリならそれ自身も開いて、その行を見せる。
  reveal: (path: string) => void;
}

// ディスクから読んだツリーと、その読み込みの状態。
interface LoadedTree {
  loadedDirectories: Set<string>;
  loadingDirectories: Set<string>;
  treeData: FileTreeNode[];
  isRootMissing: boolean;
}

interface DirectoryLoad {
  token: object;
  promise: Promise<void>;
  reloadRequested: boolean;
}

function createEmptyLoadedTree(): LoadedTree {
  return {
    loadedDirectories: new Set(),
    loadingDirectories: new Set(),
    treeData: [],
    isRootMissing: false,
  };
}

function toStatus({
  isRootMissing,
  loadingDirectories,
  treeData,
}: LoadedTree): DirectoryTreeStatus {
  if (isRootMissing) {
    return "missing";
  }
  if (treeData.length > 0) {
    return "ready";
  }
  return loadingDirectories.has(ROOT_DIRECTORY_PATH) ? "loading" : "empty";
}

// rootPath (ルートの絶対パス) は表示している間変わらない前提。
// selectedPath (ルートからの相対パス、ツリーに無ければ null) が変わったら、その行を見せる。
export function useDirectoryTree(rootPath: string, selectedPath: string | null): DirectoryTree {
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set());
  const expandedDirectoriesRef = useRef(expandedDirectories);
  const [loadedTree, setLoadedTree] = useState<LoadedTree>(() => createEmptyLoadedTree());
  const loadedTreeRef = useRef<LoadedTree>(loadedTree);
  const directoryLoadsRef = useRef<Map<string, DirectoryLoad>>(new Map());
  const lastRevealedPathRef = useRef<string | null>(null);
  const revealControllerRef = useRef<AbortController | null>(null);
  const [revealRequest, setRevealRequest] = useState<DirectoryTreeRevealRequest | null>(null);

  const commitLoadedTree = useCallback((nextLoadedTree: LoadedTree): void => {
    loadedTreeRef.current = nextLoadedTree;
    setLoadedTree(nextLoadedTree);
  }, []);

  const commitExpandedDirectories = useCallback((nextExpandedDirectories: Set<string>): void => {
    expandedDirectoriesRef.current = nextExpandedDirectories;
    setExpandedDirectories(nextExpandedDirectories);
  }, []);

  const applyTreeUpdate = useCallback(
    (relativePath: string, nextNodes: FileTreeNode[]): void => {
      const prevLoadedTree = loadedTreeRef.current;
      const update = applyDirectoryListing(prevLoadedTree.treeData, relativePath, nextNodes);
      if (!update) {
        return;
      }
      commitLoadedTree({
        ...prevLoadedTree,
        treeData: update.treeData,
        loadedDirectories: removeDirectorySubtrees(
          new Set(prevLoadedTree.loadedDirectories).add(relativePath),
          update.removedDirectoryPaths,
        ),
        isRootMissing: relativePath === ROOT_DIRECTORY_PATH ? false : prevLoadedTree.isRootMissing,
      });

      if (update.removedDirectoryPaths.length > 0) {
        commitExpandedDirectories(
          removeDirectorySubtrees(expandedDirectoriesRef.current, update.removedDirectoryPaths),
        );
      }
    },
    [commitExpandedDirectories, commitLoadedTree],
  );

  const loadDirectory = useCallback(
    async function loadDirectory(relativePath = ROOT_DIRECTORY_PATH, force = false): Promise<void> {
      if (!force && loadedTreeRef.current.loadedDirectories.has(relativePath)) {
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
        const prevLoadedTree = loadedTreeRef.current;
        commitLoadedTree({
          ...prevLoadedTree,
          loadingDirectories: new Set(prevLoadedTree.loadingDirectories).add(relativePath),
        });
        const result = await window.electronAPI.listFiles(rootPath, relativePath);
        if (directoryLoadsRef.current.get(relativePath)?.token !== loadToken) {
          return;
        }

        // 失敗は main が Error ログに記録済みなので、表示は前のままにする。
        if (!result.ok) {
          return;
        }
        if (result.data) {
          applyTreeUpdate(relativePath, result.data);
          return;
        }
        // 開いていたサブディレクトリが消えた場合は、親を読み直したときにツリーから外れる。
        if (relativePath === ROOT_DIRECTORY_PATH) {
          commitLoadedTree({ ...loadedTreeRef.current, isRootMissing: true });
        }
      })().finally(async () => {
        const directoryLoad = directoryLoadsRef.current.get(relativePath);
        if (directoryLoad?.token !== loadToken) {
          return;
        }
        directoryLoadsRef.current.delete(relativePath);
        const prevLoadedTree = loadedTreeRef.current;
        const nextLoadingDirectories = new Set(prevLoadedTree.loadingDirectories);
        nextLoadingDirectories.delete(relativePath);
        commitLoadedTree({
          ...prevLoadedTree,
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
    [applyTreeUpdate, commitLoadedTree, rootPath],
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

  const expandOnlyToShow = async (paths: string[]): Promise<void> => {
    const directoryPaths = collectAncestorDirectories(paths);

    await loadDirectory(ROOT_DIRECTORY_PATH);
    for (const directoryPath of directoryPaths) {
      await loadDirectory(directoryPath);
    }

    commitExpandedDirectories(
      normalizeExpandedDirectories(directoryPaths, loadedTreeRef.current.treeData),
    );
  };

  const collapseAll = (): void => {
    commitExpandedDirectories(new Set());
  };

  const reloadConnectedDirectories = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      const prevLoadedTree = loadedTreeRef.current;
      if (prevLoadedTree.loadingDirectories.size > 0) {
        commitLoadedTree({
          ...prevLoadedTree,
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
    [commitLoadedTree, loadDirectory],
  );

  const refreshDirectoryForReveal = useCallback(
    async (relativePath: string): Promise<void> => {
      const activeLoad = directoryLoadsRef.current.get(relativePath);
      if (activeLoad) {
        await activeLoad.promise;
        return;
      }
      await loadDirectory(relativePath, true);
    },
    [loadDirectory],
  );

  // 親から順に読み直して展開し、スクロールを頼む。中断されたら false。
  const revealPath = useCallback(
    async (relativePath: string, signal: AbortSignal): Promise<boolean> => {
      const directoryPaths = collectAncestorDirectories([relativePath]);

      await refreshDirectoryForReveal(ROOT_DIRECTORY_PATH);
      for (const directoryPath of directoryPaths) {
        if (signal.aborted) {
          return false;
        }
        if (!collectDirectoryPaths(loadedTreeRef.current.treeData).has(directoryPath)) {
          return true;
        }
        await refreshDirectoryForReveal(directoryPath);
      }

      if (signal.aborted) {
        return false;
      }
      // ツリー上でディレクトリなら、自身も読み込んで展開し、中身を見せる。
      const isDirectory = collectDirectoryPaths(loadedTreeRef.current.treeData).has(relativePath);
      if (isDirectory) {
        await refreshDirectoryForReveal(relativePath);
        if (signal.aborted) {
          return false;
        }
        directoryPaths.push(relativePath);
      }
      const nextExpandedDirectories = new Set(expandedDirectoriesRef.current);
      let didExpandDirectory = false;
      for (const directoryPath of normalizeExpandedDirectories(
        directoryPaths,
        loadedTreeRef.current.treeData,
      )) {
        if (!nextExpandedDirectories.has(directoryPath)) {
          nextExpandedDirectories.add(directoryPath);
          didExpandDirectory = true;
        }
      }
      if (didExpandDirectory) {
        commitExpandedDirectories(nextExpandedDirectories);
      }
      setRevealRequest({ kind: isDirectory ? "directory" : "file", path: relativePath });
      return true;
    },
    [commitExpandedDirectories, refreshDirectoryForReveal],
  );

  const reveal = useCallback(
    (relativePath: string): void => {
      revealControllerRef.current?.abort();
      const controller = new AbortController();
      revealControllerRef.current = controller;
      void revealPath(relativePath, controller.signal);
    },
    [revealPath],
  );

  useEffect(() => {
    void window.electronAPI.syncFileWatchTargets(rootPath, buildWatchTargets(expandedDirectories));
  }, [expandedDirectories, rootPath]);

  useEffect(() => {
    const controller = new AbortController();
    void reloadConnectedDirectories(controller.signal);
    return () => {
      controller.abort();
    };
  }, [reloadConnectedDirectories]);

  useEffect(() => {
    if (!selectedPath) {
      lastRevealedPathRef.current = null;
      return;
    }
    if (lastRevealedPathRef.current === selectedPath) {
      return;
    }

    const controller = new AbortController();
    void revealPath(selectedPath, controller.signal).then((completed) => {
      if (completed) {
        lastRevealedPathRef.current = selectedPath;
      }
    });
    return () => {
      controller.abort();
    };
  }, [revealPath, selectedPath]);

  useEffect(() => {
    const dispose = window.electronAPI.onFileTreeChanged((changedRootPath, relativePath) => {
      if (changedRootPath !== rootPath) {
        return;
      }
      void loadDirectory(relativePath, true);
    });

    return dispose;
  }, [loadDirectory, rootPath]);

  // 隠れる・消えるときは、このルートの監視をやめる。
  useEffect(() => {
    return () => {
      directoryLoadsRef.current = new Map();
      void window.electronAPI.syncFileWatchTargets(rootPath, []);
    };
  }, [rootPath]);

  return {
    rows: buildVisibleTreeRows(loadedTree.treeData, expandedDirectories),
    status: toStatus(loadedTree),
    loadingDirectories: loadedTree.loadingDirectories,
    revealRequest,
    toggleDirectory,
    collapseAll,
    expandOnlyToShow,
    reveal,
  };
}
