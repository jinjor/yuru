#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fail, withoutGitDir } from "./utils.mjs";

const yuruHome = process.env.YURU_HOME ?? path.join(os.homedir(), ".yuru");
const repoDir = process.env.YURU_REPO_DIR ?? path.join(yuruHome, "repo");
const appsDir = process.env.YURU_APPLICATIONS_DIR ?? path.join(os.homedir(), "Applications");
const appPath = path.join(appsDir, "Yuru.app");
const metadataPath = process.env.YURU_METADATA_PATH ?? path.join(yuruHome, "metadata.json");
const launcherPath = path.join(yuruHome, "bin", "yuru");
const allowedRemotes = new Set([
  "git@github.com:jinjor/yuru",
  "git@github.com:jinjor/yuru.git",
  "https://github.com/jinjor/yuru",
  "https://github.com/jinjor/yuru.git",
  "ssh://git@github.com/jinjor/yuru",
  "ssh://git@github.com/jinjor/yuru.git",
]);
// This is a safety rail for local operator mistakes, not a real security boundary.
// It helps catch accidental remote drift, such as a forgotten fork origin.
// Anyone who can edit this file or the managed checkout can also bypass this check.

export function run(command, args, options = {}) {
  const { env = process.env, ...rest } = options;
  return execFileSync(command, args, {
    cwd: repoDir,
    stdio: "inherit",
    ...rest,
    env: withoutGitDir(env),
  });
}

export function read(command, args, options = {}) {
  const { env = process.env, ...rest } = options;
  return execFileSync(command, args, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...rest,
    env: withoutGitDir(env),
  }).trim();
}

export function ensureManagedRepo() {
  if (!fs.existsSync(path.join(repoDir, ".git"))) {
    fail("Yuru is not installed yet. Run ./install.sh from a Yuru checkout.");
  }
}

export function ensureMacOS() {
  if (process.platform !== "darwin") {
    fail("Yuru local packaging is currently supported on macOS only.");
  }
}

export function ensureAppExists() {
  if (!fs.existsSync(appPath)) {
    fail("Yuru.app is not installed yet. Run: yuru latest");
  }
}

export function ensureAllowedRemote() {
  const remoteUrl = read("git", ["remote", "get-url", "origin"]);
  if (!allowedRemotes.has(remoteUrl)) {
    fail(`Refusing to update from unexpected origin: ${remoteUrl}`);
  }
}

export function ensureCleanWorktree() {
  const status = read("git", ["status", "--short"]);
  if (!status) {
    return;
  }
  fail(`Refusing to update because the managed checkout is not clean.\n${status}`);
}

export function ensureMainBranch() {
  const branch = read("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    fail(
      `Refusing to update from branch \`${branch}\`. Switch the managed checkout back to \`main\`.`,
    );
  }
}

export function ensureNpm() {
  let npmVersion;
  try {
    npmVersion = execFileSync("npm", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    fail("npm is required to update Yuru.");
  }

  const [major, minor] = npmVersion.split(".").map(Number);
  if (major < 11 || (major === 11 && minor < 16)) {
    fail(`npm 11.16.0 or later is required to update Yuru. Found npm ${npmVersion}.`);
  }
}

export function ensureAppNotRunning() {
  const processList = execFileSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const executablePath = path.join(appPath, "Contents", "MacOS");
  const runningLine = processList
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.includes(executablePath));

  if (runningLine) {
    fail("Yuru.app is running. Quit Yuru and run `yuru latest` again.");
  }
}

export function openApp() {
  ensureMacOS();
  ensureAppExists();
  run("open", ["-na", appPath], { cwd: process.cwd() });
}

function parseMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Yuru metadata must be a JSON object.");
  }
  if (value.repos === undefined) {
    return { ...value, repos: [] };
  }
  if (!Array.isArray(value.repos)) {
    fail("Yuru metadata `repos` must be an array.");
  }
  for (const repo of value.repos) {
    if (
      !repo ||
      typeof repo !== "object" ||
      Array.isArray(repo) ||
      typeof repo.id !== "string" ||
      typeof repo.repoPath !== "string"
    ) {
      fail("Yuru metadata repo entries must have string id and repoPath.");
    }
  }
  return value;
}

function loadMetadata() {
  if (!fs.existsSync(metadataPath)) {
    return { repos: [] };
  }
  return parseMetadata(JSON.parse(fs.readFileSync(metadataPath, "utf8")));
}

function saveMetadata(metadata) {
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

function resolveRepoRoot(directory) {
  const cwd = path.resolve(directory);
  try {
    return read("git", ["rev-parse", "--show-toplevel"], { cwd });
  } catch {
    fail(`Not a directory inside a Git repository: ${cwd}`);
  }
}

export function addRepo(args) {
  if (args.length !== 1) {
    fail("Usage: yuru add <directory>");
  }

  const repoPath = resolveRepoRoot(args[0]);
  const metadata = loadMetadata();
  const existingRepo = metadata.repos.find((repo) => repo.repoPath === repoPath);
  if (existingRepo) {
    console.log(`Already added: ${existingRepo.repoPath}`);
    return;
  }

  metadata.repos.push({
    id: crypto.randomUUID(),
    repoPath,
  });
  saveMetadata(metadata);
  console.log(`Added: ${repoPath}`);
}

export function updateApp() {
  ensureMacOS();
  ensureManagedRepo();
  ensureNpm();
  ensureAllowedRemote();
  ensureCleanWorktree();
  ensureMainBranch();
  ensureAppNotRunning();

  run("git", ["fetch", "origin", "main"]);
  run("git", ["pull", "--ff-only", "origin", "main"]);
  updateLauncher();
  run("npm", ["audit", "--package-lock-only", "--audit-level=high"]);
  run("npm", ["ci"]);
  run("npm", ["run", "build"]);
  run("npm", ["run", "package:local"]);
}

function updateLauncher() {
  const nextLauncherPath = `${launcherPath}.new`;
  fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
  try {
    fs.copyFileSync(path.join(repoDir, "bin", "yuru"), nextLauncherPath);
    fs.chmodSync(nextLauncherPath, 0o755);
    fs.renameSync(nextLauncherPath, launcherPath);
  } finally {
    fs.rmSync(nextLauncherPath, { force: true });
  }
}
