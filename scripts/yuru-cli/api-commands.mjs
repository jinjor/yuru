#!/usr/bin/env node

import { apiSocketPath, requestApi } from "./api-client.mjs";
import { errorMessage, fail } from "./utils.mjs";

export async function ping() {
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

export async function worktree(args) {
  if (args[0] !== "create") {
    fail("Usage: yuru worktree create <branch-name>");
  }
  await createTaskWorktree(args.slice(1));
}

const sessionCreateUsage =
  "Usage: yuru session create --worktree <path> --provider <claude|codex|kimi> [--model <model>] [--prompt <text>]";
const agents = new Set(["claude", "codex", "kimi"]);

function parseSessionCreateArgs(args) {
  let worktreePath;
  let provider;
  let model;
  let prompt;

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
    if (option === "--prompt" && prompt === undefined) {
      prompt = value;
      continue;
    }
    fail(sessionCreateUsage);
  }

  if (
    !worktreePath ||
    !provider ||
    !agents.has(provider) ||
    (model !== undefined && !model)
  ) {
    fail(sessionCreateUsage);
  }
  return { worktreePath, provider, model, prompt };
}

async function createSession(args) {
  const { worktreePath, provider, model, prompt } = parseSessionCreateArgs(args);
  apiSocketPath();

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
    (response.data.agentSessionId !== null &&
      typeof response.data.agentSessionId !== "string")
  ) {
    fail("Yuru returned an invalid session create response.");
  }
  console.log(`Created ${response.data.provider} session for ${response.data.worktreePath}`);
}

export async function sessionCommand(args) {
  if (args[0] === "create") {
    await createSession(args.slice(1));
    return;
  }
  fail("Usage: yuru session create ...");
}
