import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { AppError, Result } from "../shared/ipc.js";
import { toAppError } from "./errors.js";
import { getYuruHome } from "./yuru-home.js";

export interface ApiRequest {
  command: string;
  args: Record<string, unknown>;
}

export type ApiRequestHandler = (request: ApiRequest) => Result<unknown> | Promise<Result<unknown>>;

export interface ApiServer {
  socketPath: string;
  stop(): Promise<void>;
}

interface ApiService {
  createTaskWorktreeFromWorktreePath(
    worktreePath: string,
    branchName: string,
  ): Promise<Result<{ worktreePath: string; branchName: string }>>;
}

interface StartApiServerOptions {
  socketPath?: string;
  handleRequest?: ApiRequestHandler;
  onError?: (error: AppError) => void;
}

type IsProcessAlive = (pid: number) => boolean;

function fail(error: AppError): Result<never> {
  return {
    ok: false,
    error,
  };
}

function invalidRequest(message: string): Result<never> {
  return fail({
    code: "unknown",
    message,
  });
}

function parseRequest(line: string): ApiRequest | Result<never> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return invalidRequest("Invalid JSON request.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidRequest("Request must be a JSON object.");
  }

  const request = value as { command?: unknown; args?: unknown };
  if (typeof request.command !== "string") {
    return invalidRequest("Request command must be a string.");
  }
  if (!request.args || typeof request.args !== "object" || Array.isArray(request.args)) {
    return invalidRequest("Request args must be a JSON object.");
  }

  return {
    command: request.command,
    args: request.args as Record<string, unknown>,
  };
}

function isFailure(value: ApiRequest | Result<never>): value is Result<never> {
  return "ok" in value;
}

export function getApiSocketPath(yuruHome = getYuruHome(), pid = process.pid): string {
  return path.join(yuruHome, "run", `${pid}.sock`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    throw error;
  }
}

export async function cleanupStaleApiSockets(
  runDir: string,
  currentPid = process.pid,
  checkProcessAlive: IsProcessAlive = isProcessAlive,
): Promise<void> {
  const entries = await fs.promises.readdir(runDir, { withFileTypes: true });
  for (const entry of entries) {
    const match = /^([1-9]\d*)\.sock$/.exec(entry.name);
    if (!match || entry.isDirectory()) {
      continue;
    }

    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid > 0x7fffffff || pid === currentPid) {
      continue;
    }
    if (!checkProcessAlive(pid)) {
      await fs.promises.rm(path.join(runDir, entry.name), { force: true });
    }
  }
}

export function handleApiRequest(request: ApiRequest): Result<unknown> {
  if (request.command === "ping") {
    return {
      ok: true,
      data: "pong",
    };
  }

  return fail({
    code: "unknown",
    message: `Unknown command: ${request.command}`,
  });
}

export function createApiRequestHandler(service: ApiService): ApiRequestHandler {
  return (request) => {
    if (request.command !== "worktree.create") {
      return handleApiRequest(request);
    }

    const { worktreePath, branchName } = request.args;
    if (typeof worktreePath !== "string" || typeof branchName !== "string") {
      return invalidRequest(
        "worktree.create requires string worktreePath and branchName arguments.",
      );
    }
    return service.createTaskWorktreeFromWorktreePath(worktreePath, branchName);
  };
}

function closeServer(server: net.Server, sockets: ReadonlySet<net.Socket>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    for (const socket of sockets) {
      socket.destroy();
    }
  });
}

export async function startApiServer(options: StartApiServerOptions = {}): Promise<ApiServer> {
  const socketPath = options.socketPath ?? getApiSocketPath();
  const handleRequest = options.handleRequest ?? handleApiRequest;
  const sockets = new Set<net.Socket>();
  const runDir = path.dirname(socketPath);

  await fs.promises.mkdir(runDir, { recursive: true });
  await cleanupStaleApiSockets(runDir);
  // PID reuse can leave this process with the same path as an older crashed
  // instance. Live instances use other PID-based paths and were preserved above.
  await fs.promises.rm(socketPath, { force: true });

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");

    let input = "";
    let handled = false;

    socket.on("data", (chunk) => {
      if (handled) {
        return;
      }
      input += chunk;
      const newlineIndex = input.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      handled = true;
      socket.pause();
      const request = parseRequest(input.slice(0, newlineIndex));
      if (isFailure(request)) {
        socket.end(`${JSON.stringify(request)}\n`);
        return;
      }

      void Promise.resolve(handleRequest(request))
        .catch((error: unknown) => {
          const appError = toAppError(error);
          options.onError?.(appError);
          return fail(appError);
        })
        .then((response) => {
          socket.end(`${JSON.stringify(response)}\n`);
        });
    });
    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", (error) => {
      console.warn("[Yuru] API client connection failed", error);
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const handleListenError = (error: Error) => {
        reject(error);
      };
      server.once("error", handleListenError);
      server.listen(socketPath, () => {
        server.off("error", handleListenError);
        resolve();
      });
    });
    await fs.promises.chmod(socketPath, 0o600);
  } catch (error) {
    if (server.listening) {
      await closeServer(server, sockets);
    }
    await fs.promises.rm(socketPath, { force: true });
    throw error;
  }

  let stopped = false;
  return {
    socketPath,
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      try {
        await closeServer(server, sockets);
      } finally {
        await fs.promises.rm(socketPath, { force: true });
      }
    },
  };
}
