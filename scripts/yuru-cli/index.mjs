#!/usr/bin/env node

import { ping, sessionCommand, worktree } from "./api-commands.mjs";
import { addRepo, openApp, updateApp } from "./local-commands.mjs";
import { fail } from "./utils.mjs";

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
              [--model <model>] [--prompt <text>]
              Create a provider session for a task worktree
  yuru help   Show this message
`);
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
