import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { AppError, Result } from "../../shared/ipc.js";
import { resolveCommandPaths } from "../agents/command.js";
import { getManagedRepoDir, getYuruHome } from "../yuru-paths.js";
import type { YuruUpdateRunner } from "./updater.js";

// scripts/yuru-cli/local-commands.mjs の `latest` が受け取る flag。
const UPDATE_CHECKOUT_FLAG = "--update-checkout";
const REPLACE_APP_FLAG = "--replace-app";

// 更新の出力は画面に出さず、まるごとこのファイルに書く。前半は毎回書き直し、
// 後半 (Yuru の終了後に走るので画面がない) は同じファイルに足す。
const UPDATE_LOG_FILE = "update.log";
// 失敗を error center に残すときに、message の下に付ける出力の行数。
const ERROR_DETAIL_LINE_COUNT = 20;

export function createYuruUpdateRunner(): YuruUpdateRunner {
  const logPath = path.join(getYuruHome(), UPDATE_LOG_FILE);
  const cliPath = path.join(getManagedRepoDir(), "scripts", "yuru-cli", "index.mjs");

  return {
    updateCheckout: () =>
      runUpdateCommand({
        cliArgs: [cliPath, "latest", UPDATE_CHECKOUT_FLAG],
        logPath,
        append: false,
        detached: false,
        failureMessage: "Updating Yuru failed.",
      }),
    startAppReplacement: () =>
      runUpdateCommand({
        cliArgs: [cliPath, "latest", REPLACE_APP_FLAG],
        logPath,
        append: true,
        detached: true,
        failureMessage: "Yuru could not start the update.",
      }),
  };
}

interface UpdateCommandOptions {
  cliArgs: string[];
  logPath: string;
  append: boolean;
  // true なら Yuru が終了しても走り続ける。終了は待たず、起動できた時点で返る。
  detached: boolean;
  failureMessage: string;
}

async function runUpdateCommand(options: UpdateCommandOptions): Promise<Result<void>> {
  // Finder から起動した Electron の PATH には node も npm も git も無い。agent の起動と
  // 同じように、ログインシェルに解決させたパスと PATH で起動する。
  let node;
  try {
    node = (await resolveCommandPaths(["node"])).get("node");
  } catch (error) {
    return failure(options, error instanceof Error ? error.message : String(error));
  }
  if (!node) {
    return failure(options, "Node.js was not found in your login shell.");
  }

  let logFd: number;
  try {
    fs.mkdirSync(path.dirname(options.logPath), { recursive: true });
    logFd = fs.openSync(options.logPath, options.append ? "a" : "w");
  } catch (error) {
    return failure(options, error instanceof Error ? error.message : String(error));
  }

  try {
    const child = spawn(node.path, options.cliArgs, {
      detached: options.detached,
      env: { ...process.env, PATH: node.pathEnv },
      stdio: ["ignore", logFd, logFd],
    });

    if (options.detached) {
      const started = await new Promise<Error | null>((resolve) => {
        child.once("spawn", () => resolve(null));
        child.once("error", (error: Error) => resolve(error));
      });
      if (started) {
        return failure(options, started.message);
      }
      child.unref();
      return { ok: true, data: undefined };
    }

    const exit = await new Promise<{ code: number | null; error: Error | null }>((resolve) => {
      let spawnError: Error | null = null;
      child.once("error", (error: Error) => {
        spawnError = error;
      });
      child.once("close", (code) => resolve({ code, error: spawnError }));
    });
    if (exit.error) {
      return failure(options, exit.error.message);
    }
    if (exit.code !== 0) {
      return failure(options, readLogTail(options.logPath));
    }
    return { ok: true, data: undefined };
  } finally {
    fs.closeSync(logFd);
  }
}

function failure(options: UpdateCommandOptions, detail: string | undefined): Result<void> {
  const error: AppError = {
    code: "command_failed",
    message: options.failureMessage,
    detail: detail || undefined,
  };
  return { ok: false, error };
}

function readLogTail(logPath: string): string | undefined {
  let content: string;
  try {
    content = fs.readFileSync(logPath, "utf-8");
  } catch {
    return undefined;
  }

  const lines = content.split("\n").filter((line) => line.trim() !== "");
  return lines.slice(-ERROR_DETAIL_LINE_COUNT).join("\n") || undefined;
}
