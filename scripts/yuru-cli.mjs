#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const yuruHome = process.env.YURU_HOME ?? path.join(os.homedir(), ".yuru");
const repoDir = process.env.YURU_REPO_DIR ?? path.join(yuruHome, "repo");
const appsDir = process.env.YURU_APPLICATIONS_DIR ?? path.join(os.homedir(), "Applications");
const appPath = path.join(appsDir, "Yuru.app");
const metadataPath = process.env.YURU_METADATA_PATH ?? path.join(yuruHome, "metadata.json");
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

function withoutGitDir(env) {
  const next = { ...env };
  delete next.GIT_DIR;
  return next;
}

function printHelp() {
  console.log(`Usage: yuru [command]

Commands:
  yuru        Launch ~/Applications/Yuru.app
  yuru add    Register the current Git repository in Yuru
  yuru latest Update the managed checkout, rebuild, and replace Yuru.app
  yuru help   Show this message
`);
}

function run(command, args, options = {}) {
  const { env = process.env, ...rest } = options;
  const result = execFileSync(command, args, {
    cwd: repoDir,
    stdio: "inherit",
    ...rest,
    env: withoutGitDir(env),
  });

  return result;
}

function read(command, args, options = {}) {
  const { env = process.env, ...rest } = options;
  return execFileSync(command, args, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...rest,
    env: withoutGitDir(env),
  }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensureManagedRepo() {
  if (!fs.existsSync(path.join(repoDir, ".git"))) {
    fail("Yuru is not installed yet. Run ./install.sh from a Yuru checkout.");
  }
}

function ensureMacOS() {
  if (process.platform !== "darwin") {
    fail("Yuru local packaging is currently supported on macOS only.");
  }
}

function ensureAppExists() {
  if (!fs.existsSync(appPath)) {
    fail("Yuru.app is not installed yet. Run: yuru latest");
  }
}

function ensureAllowedRemote() {
  const remoteUrl = read("git", ["remote", "get-url", "origin"]);
  if (!allowedRemotes.has(remoteUrl)) {
    fail(`Refusing to update from unexpected origin: ${remoteUrl}`);
  }
}

function ensureCleanWorktree() {
  const status = read("git", ["status", "--short"]);
  if (!status) {
    return;
  }
  fail(`Refusing to update because the managed checkout is not clean.\n${status}`);
}

function ensureMainBranch() {
  const branch = read("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    fail(`Refusing to update from branch \`${branch}\`. Switch the managed checkout back to \`main\`.`);
  }
}

function ensureNpm() {
  try {
    execFileSync("npm", ["--version"], { stdio: "ignore" });
  } catch {
    fail("npm is required to update Yuru.");
  }
}

function ensureAppNotRunning() {
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

function openApp() {
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

function resolveRepoRoot(cwd) {
  try {
    return read("git", ["rev-parse", "--show-toplevel"], { cwd });
  } catch {
    fail("Run `yuru add` inside a Git repository.");
  }
}

function addRepo() {
  const repoPath = resolveRepoRoot(process.cwd());
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

function updateApp() {
  ensureMacOS();
  ensureManagedRepo();
  ensureNpm();
  ensureAllowedRemote();
  ensureCleanWorktree();
  ensureMainBranch();
  ensureAppNotRunning();

  run("git", ["fetch", "origin", "main"]);
  run("git", ["pull", "--ff-only", "origin", "main"]);
  run("npm", ["ci"]);
  run("npm", ["run", "build"]);
  run("npm", ["run", "package:local"]);
}

const command = process.argv[2] ?? "open";

switch (command) {
  case "open":
    openApp();
    break;
  case "add":
    addRepo();
    break;
  case "latest":
    updateApp();
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    fail(`Unknown command: ${command}\n\nRun \`yuru help\` for usage.`);
}
