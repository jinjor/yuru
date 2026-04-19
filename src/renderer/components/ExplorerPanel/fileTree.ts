import type { FileTreeNode } from "../../../shared/ipc";

export const ROOT_DIRECTORY_PATH = "";

export interface VisibleTreeRow {
  depth: number;
  isOpen: boolean;
  node: FileTreeNode;
}

function compareDirectoryPaths(left: string, right: string): number {
  const depthDiff = left.split("/").length - right.split("/").length;
  if (depthDiff !== 0) {
    return depthDiff;
  }
  return left.localeCompare(right);
}

export function replaceNodeChildren(
  nodes: FileTreeNode[],
  targetPath: string,
  nextChildren: FileTreeNode[],
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return {
        ...node,
        children: nextChildren,
      };
    }
    if (!node.children || node.children.length === 0) {
      return node;
    }
    return {
      ...node,
      children: replaceNodeChildren(node.children, targetPath, nextChildren),
    };
  });
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

export function retainLoadedDirectories(
  loadedDirectories: Iterable<string>,
  nodes: readonly FileTreeNode[],
): Set<string> {
  const validPaths = collectDirectoryPaths(nodes);
  const nextLoadedDirectories = new Set<string>([ROOT_DIRECTORY_PATH]);

  for (const relativePath of loadedDirectories) {
    if (relativePath === ROOT_DIRECTORY_PATH || validPaths.has(relativePath)) {
      nextLoadedDirectories.add(relativePath);
    }
  }

  return nextLoadedDirectories;
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
