#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const yuruHome = process.env.YURU_HOME ?? path.join(os.homedir(), ".yuru");
const repoDir = process.env.YURU_REPO_DIR ?? path.join(yuruHome, "repo");
const appsDir = process.env.YURU_APPLICATIONS_DIR ?? path.join(os.homedir(), "Applications");
const appPath = path.join(appsDir, "Yuru.app");
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

function printHelp() {
  console.log(`Usage: yuru [command]

Commands:
  yuru        Launch ~/Applications/Yuru.app
  yuru latest Update the managed checkout, rebuild, and replace Yuru.app
  yuru help   Show this message
`);
}

function run(command, args, options = {}) {
  const result = execFileSync(command, args, {
    cwd: repoDir,
    stdio: "inherit",
    env: process.env,
    ...options,
  });

  return result;
}

function read(command, args) {
  return execFileSync(command, args, {
    cwd: repoDir,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
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
