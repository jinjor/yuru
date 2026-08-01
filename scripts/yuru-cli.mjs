#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
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
  yuru add <directory>
              Register the directory's Git repository in Yuru
  yuru latest Update the managed checkout, rebuild, and replace Yuru.app
  yuru ping   Check the connection to the running Yuru app
  yuru worktree create <branch-name>
              Create a task worktree from the current worktree's repository
  yuru session create --worktree <path> --provider <claude|codex|kimi>
              [--model <model>] [--prompt <text> | --prompt-file <path>]
              Create a provider session for a task worktree
  yuru session transcript-path [--worktree <path>]
              Print the primary session transcript path for a task worktree
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

function apiSocketPath() {
  const socketPath = process.env.YURU_API_SOCKET;
  if (!socketPath) {
    fail("Yuru API is unavailable. Run this command inside a Yuru terminal.");
  }
  return socketPath;
}

function parseApiResponse(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Yuru returned invalid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Yuru returned an invalid response.");
  }
  if (value.ok === true && Object.hasOwn(value, "data")) {
    return value;
  }
  if (
    value.ok === false &&
    value.error &&
    typeof value.error === "object" &&
    !Array.isArray(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string"
  ) {
    return value;
  }
  throw new Error("Yuru returned an invalid response.");
}

function requestApi(command, args) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(apiSocketPath());
    socket.setEncoding("utf8");

    let input = "";
    let settled = false;

    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ command, args })}\n`);
    });
    socket.on("data", (chunk) => {
      if (settled) {
        return;
      }
      input += chunk;
      const newlineIndex = input.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      settled = true;
      socket.destroy();
      try {
        resolve(parseApiResponse(input.slice(0, newlineIndex)));
      } catch (error) {
        reject(error);
      }
    });
    socket.on("end", () => {
      if (!settled) {
        settled = true;
        reject(new Error("Yuru closed the connection without a response."));
      }
    });
    socket.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}

async function ping() {
  let response;
  try {
    response = await requestApi("ping", {});
  } catch (error) {
    fail(`Could not connect to Yuru: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    fail(response.error.message);
  }
  if (response.data !== "pong") {
    fail("Yuru returned an invalid ping response.");
  }
  console.log(response.data);
}

async function createTaskWorktree(args) {
  if (args.length !== 1) {
    fail("Usage: yuru worktree create <branch-name>");
  }
  apiSocketPath();
  const callerWorktreePath = process.env.YURU_WORKTREE_PATH;
  if (!callerWorktreePath) {
    fail("This command must be run inside a Yuru task worktree terminal.");
  }

  let response;
  try {
    response = await requestApi("worktree.create", {
      worktreePath: callerWorktreePath,
      branchName: args[0],
    });
  } catch (error) {
    fail(`Could not connect to Yuru: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    fail(response.error.message);
  }
  if (
    !response.data ||
    typeof response.data !== "object" ||
    Array.isArray(response.data) ||
    typeof response.data.worktreePath !== "string" ||
    typeof response.data.branchName !== "string"
  ) {
    fail("Yuru returned an invalid worktree create response.");
  }
  console.log(
    `Created worktree ${response.data.worktreePath} on branch ${response.data.branchName}`,
  );
}

async function worktree(args) {
  if (args[0] !== "create") {
    fail("Usage: yuru worktree create <branch-name>");
  }
  await createTaskWorktree(args.slice(1));
}

const sessionCreateUsage =
  "Usage: yuru session create --worktree <path> --provider <claude|codex|kimi> [--model <model>] [--prompt <text> | --prompt-file <path>]";
const sessionProviders = new Set(["claude", "codex", "kimi"]);

function parseSessionCreateArgs(args) {
  let worktreePath;
  let provider;
  let model;
  let prompt;
  let promptFile;

  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (value === undefined) {
      fail(sessionCreateUsage);
    }
    if (option === "--worktree" && worktreePath === undefined) {
      worktreePath = value;
      continue;
    }
    if (option === "--provider" && provider === undefined) {
      provider = value;
      continue;
    }
    if (option === "--model" && model === undefined) {
      model = value;
      continue;
    }
    if (option === "--prompt" && prompt === undefined && promptFile === undefined) {
      prompt = value;
      continue;
    }
    if (option === "--prompt-file" && prompt === undefined && promptFile === undefined) {
      promptFile = value;
      continue;
    }
    fail(sessionCreateUsage);
  }

  if (
    !worktreePath ||
    !provider ||
    !sessionProviders.has(provider) ||
    (model !== undefined && !model)
  ) {
    fail(sessionCreateUsage);
  }
  return { worktreePath, provider, model, prompt, promptFile };
}

async function createSession(args) {
  const {
    worktreePath,
    provider,
    model,
    prompt: inlinePrompt,
    promptFile,
  } = parseSessionCreateArgs(args);
  apiSocketPath();

  let prompt = inlinePrompt;
  if (promptFile !== undefined) {
    try {
      prompt = fs.readFileSync(promptFile, "utf8");
    } catch (error) {
      fail(`Could not read prompt file "${promptFile}": ${errorMessage(error)}`);
    }
  }

  let response;
  try {
    response = await requestApi("session.create", {
      worktreePath,
      provider,
      model,
      prompt,
    });
  } catch (error) {
    fail(`Could not connect to Yuru: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    fail(response.error.message);
  }
  if (
    !response.data ||
    typeof response.data !== "object" ||
    Array.isArray(response.data) ||
    typeof response.data.worktreePath !== "string" ||
    response.data.provider !== provider ||
    (response.data.providerSessionId !== null &&
      typeof response.data.providerSessionId !== "string")
  ) {
    fail("Yuru returned an invalid session create response.");
  }
  console.log(`Created ${response.data.provider} session for ${response.data.worktreePath}`);
}

const sessionTranscriptPathUsage =
  "Usage: yuru session transcript-path [--worktree <path>]";

function parseSessionTranscriptPathArgs(args) {
  if (args.length === 0) {
    return process.env.YURU_WORKTREE_PATH;
  }
  if (args.length === 2 && args[0] === "--worktree" && args[1]) {
    return args[1];
  }
  fail(sessionTranscriptPathUsage);
}

async function printSessionTranscriptPath(args) {
  const worktreePath = parseSessionTranscriptPathArgs(args);
  apiSocketPath();
  if (!worktreePath) {
    fail("This command requires --worktree outside a Yuru task worktree terminal.");
  }

  let response;
  try {
    response = await requestApi("session.transcript-path", { worktreePath });
  } catch (error) {
    fail(`Could not connect to Yuru: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    fail(response.error.message);
  }
  if (
    !response.data ||
    typeof response.data !== "object" ||
    Array.isArray(response.data) ||
    typeof response.data.transcriptPath !== "string"
  ) {
    fail("Yuru returned an invalid session transcript path response.");
  }
  console.log(response.data.transcriptPath);
}

async function sessionCommand(args) {
  if (args[0] === "create") {
    await createSession(args.slice(1));
    return;
  }
  if (args[0] === "transcript-path") {
    await printSessionTranscriptPath(args.slice(1));
    return;
  }
  fail("Usage: yuru session <create|transcript-path> ...");
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
    fail(
      `Refusing to update from branch \`${branch}\`. Switch the managed checkout back to \`main\`.`,
    );
  }
}

function ensureNpm() {
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

function resolveRepoRoot(directory) {
  const cwd = path.resolve(directory);
  try {
    return read("git", ["rev-parse", "--show-toplevel"], { cwd });
  } catch {
    fail(`Not a directory inside a Git repository: ${cwd}`);
  }
}

function addRepo(args) {
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
  run("npm", ["audit", "--package-lock-only", "--audit-level=high"]);
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
    addRepo(process.argv.slice(3));
    break;
  case "latest":
    updateApp();
    break;
  case "ping":
    await ping();
    break;
  case "worktree":
    await worktree(process.argv.slice(3));
    break;
  case "session":
    await sessionCommand(process.argv.slice(3));
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    fail(`Unknown command: ${command}\n\nRun \`yuru help\` for usage.`);
}
