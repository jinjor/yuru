#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const manifestRelativePath = path.join(".vite", "manifest.json");

function currentBuildFiles(rendererDir) {
  const manifestPath = path.join(rendererDir, manifestRelativePath);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Vite manifest not found: ${manifestPath}. Run \`npm run build\` first.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const files = new Set();

  for (const chunk of Object.values(manifest)) {
    files.add(chunk.file);
    for (const cssFile of chunk.css ?? []) {
      files.add(cssFile);
    }
    for (const assetFile of chunk.assets ?? []) {
      files.add(assetFile);
    }
  }

  return files;
}

function removeStaleFiles(rendererDir, directory, currentFiles, removedFiles) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      removeStaleFiles(rendererDir, absolutePath, currentFiles, removedFiles);
      if (fs.readdirSync(absolutePath).length === 0) {
        fs.rmdirSync(absolutePath);
      }
      continue;
    }

    const relativePath = path.relative(rendererDir, absolutePath);
    if (!currentFiles.has(relativePath)) {
      fs.rmSync(absolutePath);
      removedFiles.push(relativePath);
    }
  }
}

export function pruneRendererBuild(rendererDir, options = {}) {
  const currentFiles = currentBuildFiles(rendererDir);
  const removedFiles = [];
  removeStaleFiles(rendererDir, path.join(rendererDir, "assets"), currentFiles, removedFiles);

  if (options.removeManifest) {
    fs.rmSync(path.join(rendererDir, ".vite"), { recursive: true });
  }

  return removedFiles;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const rendererDir = path.join(repoDir, "dist", "renderer");
  const removedFiles = pruneRendererBuild(rendererDir);
  console.log(`Removed ${removedFiles.length} stale renderer file(s)`);
}
