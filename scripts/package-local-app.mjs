#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appsDir = process.env.YURU_APPLICATIONS_DIR ?? path.join(os.homedir(), "Applications");
const finalAppPath = path.join(appsDir, "Yuru.app");
const backupAppPath = path.join(appsDir, "Yuru.app.old");
const packageVersion = JSON.parse(fs.readFileSync(path.join(repoDir, "package.json"), "utf8")).version;
const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;

// @electron/packager applies ignore patterns to root-relative paths such as
// "/src/main.ts". Anchor them so we exclude only top-level project entries.
const ignorePatterns = [
  /^\/\.claude(?:$|\/)/,
  /^\/\.git(?:$|\/)/,
  /^\/\.yuru(?:$|\/)/,
  /^\/bin(?:$|\/)/,
  /^\/docs(?:$|\/)/,
  /^\/src(?:$|\/)/,
  /^\/install\.sh$/,
  /^\/scripts(?:$|\/)/,
  /^\/tsconfig\.json$/,
  /^\/vite\.config\.mts$/,
  /^\/AGENTS\.md$/,
  /^\/CLAUDE\.md$/,
  /^\/\.oxfmtrc\.json$/,
];

function ensureMacOS() {
  if (process.platform !== "darwin") {
    throw new Error("Local app packaging is currently supported on macOS only.");
  }
}

function ensureBuildOutput() {
  const mainEntry = path.join(repoDir, "dist", "main", "index.js");
  if (!fs.existsSync(mainEntry)) {
    throw new Error("Build output is missing. Run `npm run build` first.");
  }
}

function stageReplacement(stagedAppPath) {
  fs.rmSync(backupAppPath, { recursive: true, force: true });

  if (!fs.existsSync(finalAppPath)) {
    fs.renameSync(stagedAppPath, finalAppPath);
    return;
  }

  fs.renameSync(finalAppPath, backupAppPath);
  try {
    fs.renameSync(stagedAppPath, finalAppPath);
    fs.rmSync(backupAppPath, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(backupAppPath) && !fs.existsSync(finalAppPath)) {
      fs.renameSync(backupAppPath, finalAppPath);
    }
    throw error;
  }
}

async function main() {
  ensureMacOS();
  ensureBuildOutput();
  fs.mkdirSync(appsDir, { recursive: true });
  const packageRoot = fs.mkdtempSync(path.join(appsDir, ".yuru-package-"));

  try {
    const outputs = await packager({
      dir: repoDir,
      name: "Yuru",
      appBundleId: "dev.jinjor.yuru",
      appCategoryType: "public.app-category.developer-tools",
      appVersion: packageVersion,
      arch,
      overwrite: true,
      out: packageRoot,
      platform: "darwin",
      prune: true,
      quiet: true,
      ignore: ignorePatterns,
    });

    const stagedRootPath = outputs[0];
    const stagedAppPath = stagedRootPath ? path.join(stagedRootPath, "Yuru.app") : "";
    if (!stagedAppPath || !fs.existsSync(stagedAppPath)) {
      throw new Error("Packager did not produce Yuru.app.");
    }

    stageReplacement(stagedAppPath);
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true });
  }
}

await main();
