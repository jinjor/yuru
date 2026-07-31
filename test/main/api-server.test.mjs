import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cleanupStaleApiSockets,
  createApiRequestHandler,
  getApiSocketPath,
  handleApiRequest,
  startApiServer,
} from "../../src/main/api-server.ts";

function request(socketPath, value) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.setEncoding("utf8");
    let input = "";

    socket.on("connect", () => {
      socket.write(`${value}\n`);
    });
    socket.on("data", (chunk) => {
      input += chunk;
      const newlineIndex = input.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      socket.destroy();
      resolve(JSON.parse(input.slice(0, newlineIndex)));
    });
    socket.on("error", reject);
  });
}

test("getApiSocketPath は YURU_HOME 配下に pid 固有の path を作る", () => {
  assert.equal(getApiSocketPath("/tmp/yuru-home", 123), "/tmp/yuru-home/run/123.sock");
});

test("cleanupStaleApiSockets は死んだ pid の socket だけを削除する", async (t) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-api-cleanup-"));
  t.after(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  for (const name of ["101.sock", "202.sock", "303.sock", "other.sock"]) {
    fs.writeFileSync(path.join(runDir, name), "");
  }

  await cleanupStaleApiSockets(runDir, 202, (pid) => pid === 101);

  assert.deepEqual(fs.readdirSync(runDir).sort(), ["101.sock", "202.sock", "other.sock"]);
});

test("handleApiRequest は ping に pong を返し、未知の command を拒否する", () => {
  assert.deepEqual(handleApiRequest({ command: "ping", args: {} }), {
    ok: true,
    data: "pong",
  });
  assert.deepEqual(handleApiRequest({ command: "missing", args: {} }), {
    ok: false,
    error: {
      code: "unknown",
      message: "Unknown command: missing",
    },
  });
});

test("createApiRequestHandler は worktree.create を service に渡す", async () => {
  const calls = [];
  const handler = createApiRequestHandler({
    async createTaskWorktreeFromWorktreePath(worktreePath, branchName) {
      calls.push({ worktreePath, branchName });
      return {
        ok: true,
        data: {
          worktreePath: "/repo/.yuru/worktrees/child-task",
          branchName,
        },
      };
    },
  });

  assert.deepEqual(
    await handler({
      command: "worktree.create",
      args: {
        worktreePath: "/repo/.yuru/worktrees/parent-task",
        branchName: "child-task",
      },
    }),
    {
      ok: true,
      data: {
        worktreePath: "/repo/.yuru/worktrees/child-task",
        branchName: "child-task",
      },
    },
  );
  assert.deepEqual(calls, [
    {
      worktreePath: "/repo/.yuru/worktrees/parent-task",
      branchName: "child-task",
    },
  ]);
});

test("createApiRequestHandler は worktree.create の不正な引数を拒否する", async () => {
  const handler = createApiRequestHandler({
    async createTaskWorktreeFromWorktreePath() {
      throw new Error("must not be called");
    },
  });

  assert.deepEqual(await handler({ command: "worktree.create", args: { branchName: 42 } }), {
    ok: false,
    error: {
      code: "unknown",
      message: "worktree.create requires string worktreePath and branchName arguments.",
    },
  });
});

test("API server は 0600 の Unix socket で NDJSON を往復し、停止時に削除する", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-api-server-"));
  const socketPath = path.join(tempDir, "run", "api.sock");
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  fs.writeFileSync(socketPath, "stale");

  const server = await startApiServer({ socketPath });
  t.after(async () => {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);
  assert.deepEqual(await request(socketPath, JSON.stringify({ command: "ping", args: {} })), {
    ok: true,
    data: "pong",
  });
  assert.deepEqual(await request(socketPath, "{"), {
    ok: false,
    error: {
      code: "unknown",
      message: "Invalid JSON request.",
    },
  });

  await server.stop();
  assert.equal(fs.existsSync(socketPath), false);
});
