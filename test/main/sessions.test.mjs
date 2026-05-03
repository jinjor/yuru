import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const previousHome = process.env.HOME;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-sessions-test-"));
process.env.HOME = tempDir;

const claudeDir = path.join(tempDir, ".claude");
const staleProject = path.join(tempDir, "missing-worktree");
const runtimeProject = path.join(tempDir, "live-worktree");
fs.mkdirSync(claudeDir, { recursive: true });
fs.mkdirSync(runtimeProject, { recursive: true });
fs.writeFileSync(
  path.join(claudeDir, "history.jsonl"),
  `${JSON.stringify({
    sessionId: "claude-1",
    project: staleProject,
    display: "last message",
    timestamp: 1000,
  })}\n`,
);

const { loadSessions } = await import("../../src/main/sessions.ts");
const { toSessionKey } = await import("../../src/shared/session.ts");

test.after(() => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("loadSessions は active runtime の cwd を snapshot project より優先する", async () => {
  const sessionKey = toSessionKey("claude", "claude-1");
  const sessions = await loadSessions(
    new Map([
      [
        sessionKey,
        {
          cwd: runtimeProject,
          provider: "claude",
          providerSessionId: "claude-1",
          startedAt: 2000,
        },
      ],
    ]),
  );

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, sessionKey);
  assert.equal(sessions[0].state, "active");
  assert.equal(sessions[0].project, runtimeProject);
});
