#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseSync, Visitor } from "oxc-parser";

const sourceExtensions = [".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"];
const sourceExtensionSet = new Set(sourceExtensions);
const resolvableSourceExtensions = [
  ".cjs",
  ".cts",
  ".d.cts",
  ".d.mts",
  ".d.ts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
];
const sourceExtensionsByRuntimeExtension = new Map([
  [".js", [".ts", ".tsx", ".d.ts"]],
  [".jsx", [".tsx", ".d.ts"]],
  [".mjs", [".mts", ".d.mts"]],
  [".cjs", [".cts", ".d.cts"]],
]);

function listSourceFiles(directory) {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
      continue;
    }
    if (entry.isFile() && sourceExtensionSet.has(path.extname(entry.name))) {
      files.push(path.resolve(entryPath));
    }
  }

  return files.sort();
}

function moduleSpecifiers(filePath) {
  const result = parseSync(filePath, fs.readFileSync(filePath, "utf8"));
  if (result.errors.length > 0) {
    throw new Error(`Could not parse ${filePath}: ${result.errors[0].message}`);
  }
  const specifiers = new Set();

  for (const declaration of result.module.staticImports) {
    specifiers.add(declaration.moduleRequest.value);
  }
  for (const declaration of result.module.staticExports) {
    for (const entry of declaration.entries) {
      if (entry.moduleRequest) {
        specifiers.add(entry.moduleRequest.value);
      }
    }
  }

  const visitor = new Visitor({
    ImportExpression(node) {
      if (node.source.type === "Literal" && typeof node.source.value === "string") {
        specifiers.add(node.source.value);
      }
    },
    TSImportType(node) {
      specifiers.add(node.source.value);
    },
  });
  visitor.visit(result.program);

  return [...specifiers];
}

function resolveRelativeModule(fromFile, specifier, sourceFiles) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const unresolvedPath = path.resolve(path.dirname(fromFile), specifier);
  const extension = path.extname(unresolvedPath);
  const candidates = [unresolvedPath];

  if (extension) {
    const sourceAlternatives = sourceExtensionsByRuntimeExtension.get(extension) ?? [];
    const pathWithoutExtension = unresolvedPath.slice(0, -extension.length);
    for (const sourceExtension of sourceAlternatives) {
      candidates.push(`${pathWithoutExtension}${sourceExtension}`);
    }
  } else {
    for (const sourceExtension of resolvableSourceExtensions) {
      candidates.push(`${unresolvedPath}${sourceExtension}`);
      candidates.push(path.join(unresolvedPath, `index${sourceExtension}`));
    }
  }

  return candidates.find((candidate) => sourceFiles.has(candidate)) ?? null;
}

function siblingDirectoryDependency(rootDirectory, fromFile, toFile) {
  const fromRelativeDirectory = path.relative(rootDirectory, path.dirname(fromFile));
  const toRelativeDirectory = path.relative(rootDirectory, path.dirname(toFile));
  const fromDirectories = fromRelativeDirectory ? fromRelativeDirectory.split(path.sep) : [];
  const toDirectories = toRelativeDirectory ? toRelativeDirectory.split(path.sep) : [];
  let commonLength = 0;

  while (
    commonLength < fromDirectories.length &&
    commonLength < toDirectories.length &&
    fromDirectories[commonLength] === toDirectories[commonLength]
  ) {
    commonLength++;
  }

  if (commonLength === fromDirectories.length || commonLength === toDirectories.length) {
    return null;
  }

  return {
    parentDirectory: path.join(rootDirectory, ...fromDirectories.slice(0, commonLength)),
    fromDirectory: fromDirectories[commonLength],
    toDirectory: toDirectories[commonLength],
    fromFile,
    toFile,
  };
}

function stronglyConnectedComponents(nodes, adjacency) {
  const components = [];
  const stack = [];
  const stackNodes = new Set();
  const indices = new Map();
  const lowLinks = new Map();
  let nextIndex = 0;

  function connect(node) {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex++;
    stack.push(node);
    stackNodes.add(node);

    for (const neighbor of [...(adjacency.get(node) ?? [])].sort()) {
      if (!indices.has(neighbor)) {
        connect(neighbor);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(neighbor)));
      } else if (stackNodes.has(neighbor)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(neighbor)));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) {
      return;
    }

    const component = [];
    let member;
    do {
      member = stack.pop();
      stackNodes.delete(member);
      component.push(member);
    } while (member !== node);
    components.push(component.sort());
  }

  for (const node of [...nodes].sort()) {
    if (!indices.has(node)) {
      connect(node);
    }
  }

  return components;
}

function findCycle(component, adjacency, dependencies) {
  const componentNodes = new Set(component);
  const start = component[0];

  function visit(node, pathNodes, pathDependencies) {
    for (const neighbor of [...(adjacency.get(node) ?? [])].sort()) {
      if (!componentNodes.has(neighbor)) {
        continue;
      }
      const dependency = dependencies.get(`${node}\0${neighbor}`);
      if (neighbor === start) {
        return [...pathDependencies, dependency];
      }
      if (pathNodes.has(neighbor)) {
        continue;
      }
      pathNodes.add(neighbor);
      const cycle = visit(neighbor, pathNodes, [...pathDependencies, dependency]);
      if (cycle) {
        return cycle;
      }
      pathNodes.delete(neighbor);
    }
    return null;
  }

  return visit(start, new Set([start]), []);
}

export function findSiblingDirectoryCycles(rootDirectory) {
  const resolvedRoot = path.resolve(rootDirectory);
  const sourceFileList = listSourceFiles(resolvedRoot);
  const sourceFiles = new Set(sourceFileList);
  const graphs = new Map();

  for (const fromFile of sourceFileList) {
    for (const specifier of moduleSpecifiers(fromFile)) {
      const toFile = resolveRelativeModule(fromFile, specifier, sourceFiles);
      if (!toFile) {
        continue;
      }
      const dependency = siblingDirectoryDependency(resolvedRoot, fromFile, toFile);
      if (!dependency || dependency.fromDirectory === dependency.toDirectory) {
        continue;
      }
      let graph = graphs.get(dependency.parentDirectory);
      if (!graph) {
        graph = { nodes: new Set(), adjacency: new Map(), dependencies: new Map() };
        graphs.set(dependency.parentDirectory, graph);
      }
      graph.nodes.add(dependency.fromDirectory);
      graph.nodes.add(dependency.toDirectory);
      let neighbors = graph.adjacency.get(dependency.fromDirectory);
      if (!neighbors) {
        neighbors = new Set();
        graph.adjacency.set(dependency.fromDirectory, neighbors);
      }
      neighbors.add(dependency.toDirectory);
      const dependencyKey = `${dependency.fromDirectory}\0${dependency.toDirectory}`;
      if (!graph.dependencies.has(dependencyKey)) {
        graph.dependencies.set(dependencyKey, dependency);
      }
    }
  }

  const cycles = [];
  for (const [parentDirectory, graph] of [...graphs.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    for (const component of stronglyConnectedComponents(graph.nodes, graph.adjacency)) {
      if (component.length < 2) {
        continue;
      }
      cycles.push({
        parentDirectory,
        directories: component,
        dependencies: findCycle(component, graph.adjacency, graph.dependencies),
      });
    }
  }

  return cycles;
}

function displayPath(filePath) {
  return path.relative(process.cwd(), filePath) || ".";
}

function reportCycles(cycles) {
  for (const cycle of cycles) {
    const directoryCycle = [
      ...cycle.dependencies.map((dependency) => dependency.fromDirectory),
      cycle.dependencies.at(-1).toDirectory,
    ];
    console.error(
      `${displayPath(cycle.parentDirectory)}: sibling directory cycle: ${directoryCycle.join(" -> ")}`,
    );
    for (const dependency of cycle.dependencies) {
      console.error(
        `  ${displayPath(dependency.fromFile)} imports ${displayPath(dependency.toFile)}`,
      );
    }
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedUrl === import.meta.url) {
  const rootDirectories = process.argv.slice(2);
  if (rootDirectories.length === 0) {
    console.error("Usage: check-structure <directory> [...directories]");
    process.exitCode = 1;
  } else {
    const cycles = rootDirectories.flatMap(findSiblingDirectoryCycles);
    if (cycles.length > 0) {
      reportCycles(cycles);
      process.exitCode = 1;
    }
  }
}
