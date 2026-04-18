import type { FileTreeNode } from "../../../shared/ipc";

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

  return Array.from(directories).sort((a, b) => {
    const depthDiff = a.split("/").length - b.split("/").length;
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return a.localeCompare(b);
  });
}

export function collectDirectoryPaths(nodes: FileTreeNode[]): Set<string> {
  const paths = new Set<string>();

  function walk(nextNodes: FileTreeNode[]): void {
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
  expandedDirectories: readonly string[],
  nodes: FileTreeNode[],
): string[] {
  const validPaths = collectDirectoryPaths(nodes);
  return expandedDirectories.filter((path) => validPaths.has(path));
}
