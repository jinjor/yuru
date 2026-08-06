import type { FileTreeNode } from "../../../shared/ipc";

export const ROOT_DIRECTORY_PATH = "";

export interface VisibleTreeRow {
  depth: number;
  isOpen: boolean;
  node: FileTreeNode;
}

export interface DirectoryListingUpdate {
  removedDirectoryPaths: string[];
  treeData: FileTreeNode[];
}

function compareDirectoryPaths(left: string, right: string): number {
  const depthDiff = left.split("/").length - right.split("/").length;
  if (depthDiff !== 0) {
    return depthDiff;
  }
  return left.localeCompare(right);
}

function mergeRetainedDirectoryChildren(
  previousNodes: readonly FileTreeNode[],
  nextNodes: readonly FileTreeNode[],
): FileTreeNode[] {
  const previousDirectories = new Map(
    previousNodes
      .filter((node) => node.kind === "directory")
      .map((node) => [node.path, node] as const),
  );

  return nextNodes.map((node) => {
    if (node.kind !== "directory") {
      return node;
    }
    const previousNode = previousDirectories.get(node.path);
    return previousNode ? { ...node, children: previousNode.children } : node;
  });
}

function collectRemovedDirectoryPaths(
  previousNodes: readonly FileTreeNode[],
  nextNodes: readonly FileTreeNode[],
): string[] {
  const nextDirectoryPaths = new Set(
    nextNodes.filter((node) => node.kind === "directory").map((node) => node.path),
  );
  return previousNodes
    .filter((node) => node.kind === "directory" && !nextDirectoryPaths.has(node.path))
    .map((node) => node.path);
}

export function applyDirectoryListing(
  treeData: FileTreeNode[],
  parentPath: string,
  nextNodes: FileTreeNode[],
): DirectoryListingUpdate | null {
  if (parentPath === ROOT_DIRECTORY_PATH) {
    return {
      removedDirectoryPaths: collectRemovedDirectoryPaths(treeData, nextNodes),
      treeData: mergeRetainedDirectoryChildren(treeData, nextNodes),
    };
  }

  let parentFound = false;
  let removedDirectoryPaths: string[] = [];
  const replaceChildren = (nodes: FileTreeNode[]): FileTreeNode[] =>
    nodes.map((node) => {
      if (node.path === parentPath) {
        parentFound = true;
        const previousChildren = node.children ?? [];
        removedDirectoryPaths = collectRemovedDirectoryPaths(previousChildren, nextNodes);
        return {
          ...node,
          children: mergeRetainedDirectoryChildren(previousChildren, nextNodes),
        };
      }
      if (!node.children || node.children.length === 0) {
        return node;
      }
      return {
        ...node,
        children: replaceChildren(node.children),
      };
    });

  const nextTreeData = replaceChildren(treeData);
  return parentFound ? { removedDirectoryPaths, treeData: nextTreeData } : null;
}

export function removeDirectorySubtrees(
  directoryPaths: Iterable<string>,
  removedDirectoryPaths: readonly string[],
): Set<string> {
  return new Set(
    Array.from(directoryPaths).filter(
      (path) =>
        !removedDirectoryPaths.some(
          (removedPath) => path === removedPath || path.startsWith(`${removedPath}/`),
        ),
    ),
  );
}

export function collectAncestorDirectories(filePaths: string[]): string[] {
  const directories = new Set<string>();

  for (const filePath of filePaths) {
    const segments = filePath.split("/");
    for (let i = 1; i < segments.length; i++) {
      directories.add(segments.slice(0, i).join("/"));
    }
  }

  return Array.from(directories).sort(compareDirectoryPaths);
}

export function collectDirectoryPaths(nodes: readonly FileTreeNode[]): Set<string> {
  const paths = new Set<string>();

  function walk(nextNodes: readonly FileTreeNode[]): void {
    for (const node of nextNodes) {
      if (node.kind !== "directory") {
        continue;
      }

      paths.add(node.path);
      if (node.children) {
        walk(node.children);
      }
    }
  }

  walk(nodes);
  return paths;
}

export function normalizeExpandedDirectories(
  expandedDirectories: Iterable<string>,
  nodes: readonly FileTreeNode[],
): Set<string> {
  const validPaths = collectDirectoryPaths(nodes);
  const normalized = new Set<string>();
  const candidatePaths = Array.from(expandedDirectories)
    .filter((path) => validPaths.has(path))
    .sort(compareDirectoryPaths);

  for (const relativePath of candidatePaths) {
    const segments = relativePath.split("/");
    let allAncestorsOpen = true;
    for (let i = 1; i < segments.length; i++) {
      if (!normalized.has(segments.slice(0, i).join("/"))) {
        allAncestorsOpen = false;
        break;
      }
    }
    if (allAncestorsOpen) {
      normalized.add(relativePath);
    }
  }

  return normalized;
}

export function buildWatchTargets(expandedDirectories: ReadonlySet<string>): string[] {
  return [ROOT_DIRECTORY_PATH, ...Array.from(expandedDirectories).sort(compareDirectoryPaths)];
}

export function buildVisibleTreeRows(
  nodes: readonly FileTreeNode[],
  expandedDirectories: ReadonlySet<string>,
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];

  function walk(nextNodes: readonly FileTreeNode[], depth: number): void {
    for (const node of nextNodes) {
      const isOpen = node.kind === "directory" && expandedDirectories.has(node.path);
      rows.push({ depth, isOpen, node });
      if (isOpen && node.children) {
        walk(node.children, depth + 1);
      }
    }
  }

  walk(nodes, 0);
  return rows;
}
