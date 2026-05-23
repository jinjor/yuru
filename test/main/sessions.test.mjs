import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const previousHome = process.env.HOME;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-sessions-test-"));
process.env.HOME = tempDir;

const claudeDir = path.join(tempDir, ".claude");
const codexDir = path.join(tempDir, ".codex");
const staleProject = path.join(tempDir, "missing-worktree");
fs.mkdirSync(claudeDir, { recursive: true });
fs.mkdirSync(codexDir, { recursive: true });
fs.writeFileSync(
  path.join(claudeDir, "history.jsonl"),
  `${JSON.stringify({
    sessionId: "claude-1",
    project: staleProject,
    display: "last message",
    timestamp: 1000,
  })}\n`,
);

const {
  loadStoredSessionPreviews,
  loadSuggestedWorktreeSessions,
} = await import("../../src/main/sessions.ts");
const { sessionProvider: codexProvider } = await import("../../src/main/agents/codex/index.ts");
const { sessionProvider: claudeProvider } = await import("../../src/main/agents/claude/index.ts");
const { toSessionKey } = await import("../../src/shared/session.ts");

function jsonl(...entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

test.after(() => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("loadStoredSessionPreviews は stored session の preview を key で返す", async () => {
  const previews = await loadStoredSessionPreviews();

  assert.equal(previews.get(toSessionKey("claude", "claude-1")), "last message");
});

test("provider resume launch は repo root で起動する", async () => {
  const repoRoot = path.join(tempDir, "repo");
  const worktreePath = path.join(repoRoot, ".yuru", "worktrees", "task-a");

  assert.deepEqual(
    await claudeProvider.createResumeLaunch({
      provider: "claude",
      providerSessionId: "claude-resume",
      repoPath: repoRoot,
      project: worktreePath,
    }),
    {
      cwd: repoRoot,
      args: ["--resume", "claude-resume"],
      worktreePath,
    },
  );
  assert.deepEqual(
    await codexProvider.createResumeLaunch({
      provider: "codex",
      providerSessionId: "codex-resume",
      repoPath: repoRoot,
      project: worktreePath,
    }),
    {
      cwd: repoRoot,
      args: ["resume", "--all", "codex-resume"],
      worktreePath,
    },
  );
});

test("provider worktree launch は repo root で起動して hidden context を注入する", async () => {
  const repoPath = path.join(tempDir, "launch-repo");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "task-a");
  const context = {
    repoPath,
    worktreePath,
    worktreeName: "task-a",
    branchName: "feature/task-a",
  };
  const prompt =
    "Yuru opened this session for the task worktree 'task-a' on branch 'feature/task-a'. " +
    `Use ${worktreePath} as the working directory for this task. ` +
    `When reading files, editing files, applying patches, running commands, building, or testing, operate in ${worktreePath}. ` +
    `The repository root ${repoPath} is only the parent repository that Yuru used to launch this provider session; do not treat it as the task workspace unless the user explicitly asks you to.`;

  assert.deepEqual(await claudeProvider.createWorktreeLaunch(context), {
    cwd: repoPath,
    args: ["--append-system-prompt", prompt],
    worktreePath,
  });

  const codexLaunch = await codexProvider.createWorktreeLaunch(context);
  assert.equal(codexLaunch.cwd, repoPath);
  assert.deepEqual(codexLaunch.args, [
    "-c",
    `developer_instructions=${JSON.stringify(prompt)}`,
  ]);
  assert.equal(codexLaunch.worktreePath, worktreePath);
  assert.ok(codexLaunch.existingProviderSessionIds instanceof Set);
});

test("loadSuggestedWorktreeSessions は suggested session を worktree ごとに dedup して並べる", async () => {
  const projectsDir = path.join(claudeDir, "projects", "repo");
  fs.mkdirSync(projectsDir, { recursive: true });
  const worktreeA = path.join(tempDir, "repo", ".claude", "worktrees", "task-a");
  const worktreeB = path.join(tempDir, "repo", ".claude", "worktrees", "task-b");
  fs.writeFileSync(
    path.join(projectsDir, "b.jsonl"),
    jsonl({
      type: "user",
      sessionId: "claude-b",
      cwd: path.join(worktreeA, "src"),
    }),
  );
  fs.writeFileSync(
    path.join(projectsDir, "a.jsonl"),
    jsonl({
      type: "user",
      sessionId: "claude-a",
      cwd: worktreeA,
    }),
  );
  fs.writeFileSync(
    path.join(projectsDir, "a-duplicate.jsonl"),
    jsonl({
      type: "assistant",
      sessionId: "claude-a",
      cwd: worktreeA,
    }),
  );
  fs.writeFileSync(
    path.join(projectsDir, "other-worktree.jsonl"),
    jsonl({
      type: "user",
      sessionId: "claude-a",
      cwd: worktreeB,
    }),
  );
  const codexSessionsDir = path.join(codexDir, "sessions", "2026", "05", "08");
  fs.mkdirSync(codexSessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexSessionsDir, "codex-a.jsonl"),
    jsonl({
      type: "session_meta",
      payload: {
        id: "codex-a",
        cwd: path.join(worktreeA, "src"),
      },
    }),
  );
  fs.writeFileSync(
    path.join(codexSessionsDir, "codex-b.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-b",
          cwd: path.join(tempDir, "repo"),
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          cwd: worktreeB,
        },
      },
    ),
  );

  const suggestions = await loadSuggestedWorktreeSessions([worktreeB, worktreeA]);

  assert.deepEqual(suggestions.get(worktreeA), [
    { provider: "claude", providerSessionId: "claude-a", timestamp: 0 },
    { provider: "claude", providerSessionId: "claude-b", timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-a", timestamp: 0 },
  ]);
  assert.deepEqual(suggestions.get(worktreeB), [
    { provider: "claude", providerSessionId: "claude-a", timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-b", timestamp: 0 },
  ]);
});

test("loadSuggestedWorktreeSessions は rg が無ければ失敗する", async () => {
  const previousPath = process.env.PATH;
  const emptyBinDir = path.join(tempDir, "empty-bin");
  const worktreePath = path.join(tempDir, "repo-rg-required", ".yuru", "worktrees", "task-a");
  fs.mkdirSync(emptyBinDir, { recursive: true });
  fs.mkdirSync(path.join(claudeDir, "projects", "rg-required"), { recursive: true });

  process.env.PATH = emptyBinDir;
  try {
    await assert.rejects(() => loadSuggestedWorktreeSessions([worktreePath]), {
      code: "ENOENT",
    });
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }
});

test("loadSuggestedWorktreeSessions は同じ worktreeRank なら session id で安定して並べる", async () => {
  const worktreePath = path.join(tempDir, "repo", ".yuru", "worktrees", "ranked");
  const codexSessionsDir = path.join(codexDir, "sessions", "2026", "05", "09");
  fs.mkdirSync(codexSessionsDir, { recursive: true });

  fs.writeFileSync(
    path.join(codexSessionsDir, "rank-weak.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-weak",
          cwd: path.join(tempDir, "repo"),
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          content: [{ type: "output_text", text: `Created ${worktreePath}` }],
        },
      },
    ),
  );
  fs.writeFileSync(
    path.join(codexSessionsDir, "rank-patch.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-patch",
          cwd: path.join(tempDir, "repo"),
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          changes: {
            [path.join(worktreePath, "file.txt")]: { type: "add" },
          },
        },
      },
    ),
  );
  fs.writeFileSync(
    path.join(codexSessionsDir, "rank-workdir.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-workdir",
          cwd: path.join(tempDir, "repo"),
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pwd", workdir: worktreePath }),
        },
      },
    ),
  );
  fs.writeFileSync(
    path.join(codexSessionsDir, "rank-meta.jsonl"),
    jsonl({
      type: "session_meta",
      payload: {
        id: "codex-meta",
        cwd: worktreePath,
      },
    }),
  );

  const suggestions = await loadSuggestedWorktreeSessions([worktreePath]);

  assert.deepEqual(suggestions.get(worktreePath), [
    { provider: "codex", providerSessionId: "codex-meta", timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-patch", timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-workdir", timestamp: 0 },
  ]);
});

test("loadSuggestedWorktreeSessions は短い worktree 名でも Codex ログの大量一致で落ちない", async (t) => {
  const repoPath = path.join(tempDir, "repo-short-noise");
  const worktreePath = path.join(repoPath, ".yuru", "worktrees", "f40");
  const codexSessionsDir = path.join(codexDir, "sessions", "2026", "05", "short-noise");
  fs.mkdirSync(codexSessionsDir, { recursive: true });
  t.after(() => {
    fs.rmSync(codexSessionsDir, { recursive: true, force: true });
  });

  const noiseLine = JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      content: [{ type: "output_text", text: "f40 ".repeat(1024) }],
    },
  });
  fs.writeFileSync(
    path.join(codexSessionsDir, "short-name-noise.jsonl"),
    `${JSON.stringify({
      type: "session_meta",
      payload: {
        id: "codex-noise",
        cwd: repoPath,
      },
    })}\n${`${noiseLine}\n`.repeat(3000)}`,
  );

  const suggestions = await loadSuggestedWorktreeSessions([worktreePath]);

  assert.equal(suggestions.get(worktreePath), undefined);
});

test("loadSuggestedWorktreeSessions は session 内で対象 worktree の順位が高い session を先に返す", async () => {
  const repoPath = path.join(tempDir, "repo-focus");
  const targetWorktree = path.join(repoPath, ".yuru", "worktrees", "target");
  const sideWorktree = path.join(repoPath, ".yuru", "worktrees", "side");
  const codexSessionsDir = path.join(codexDir, "sessions", "2026", "05", "10");
  fs.mkdirSync(codexSessionsDir, { recursive: true });

  fs.writeFileSync(
    path.join(codexSessionsDir, "focus-shared.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-shared",
          cwd: repoPath,
          timestamp: "2026-05-10T00:00:01.000Z",
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          changes: {
            [path.join(sideWorktree, "file.txt")]: { type: "add" },
          },
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "git status", workdir: targetWorktree }),
        },
      },
    ),
  );
  fs.writeFileSync(
    path.join(codexSessionsDir, "focus-target.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-target",
          cwd: repoPath,
          timestamp: "2026-05-10T00:00:02.000Z",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "git status", workdir: targetWorktree }),
        },
      },
    ),
  );

  const suggestions = await loadSuggestedWorktreeSessions([targetWorktree, sideWorktree]);

  assert.deepEqual(
    suggestions.get(targetWorktree)?.map((session) => session.providerSessionId),
    ["codex-target", "codex-shared"],
  );
  assert.deepEqual(suggestions.get(targetWorktree)?.[0], {
    provider: "codex",
    providerSessionId: "codex-target",
    timestamp: Date.parse("2026-05-10T00:00:02.000Z"),
  });
});
