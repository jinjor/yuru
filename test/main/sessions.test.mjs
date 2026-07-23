import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const previousHome = process.env.HOME;
const previousKimiCodeHome = process.env.KIMI_CODE_HOME;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-sessions-test-"));
process.env.HOME = tempDir;

const claudeDir = path.join(tempDir, ".claude");
const codexDir = path.join(tempDir, ".codex");
const kimiDir = path.join(tempDir, ".kimi-code");
process.env.KIMI_CODE_HOME = kimiDir;
const staleProject = path.join(tempDir, "missing-worktree");
const missingClaudeSessionId = "claude-missing-file";
fs.mkdirSync(claudeDir, { recursive: true });
fs.mkdirSync(codexDir, { recursive: true });
fs.writeFileSync(
  path.join(claudeDir, "history.jsonl"),
  `${JSON.stringify({
    sessionId: "claude-1",
    project: staleProject,
    display: "last message",
    timestamp: 1000,
  })}\n${JSON.stringify({
    sessionId: missingClaudeSessionId,
    project: staleProject,
    display: "missing session file",
    timestamp: 2000,
  })}\n`,
);

const {
  loadStoredSessionPreview,
  loadStoredSessionPreviews,
  loadSuggestedWorktreeSessions,
} = await import("../../src/main/sessions.ts");
const { sessionProvider: codexProvider } = await import("../../src/main/agents/codex/index.ts");
const { sessionProvider: claudeProvider } = await import("../../src/main/agents/claude/index.ts");
const { sessionProvider: kimiProvider } = await import("../../src/main/agents/kimi/index.ts");
const { toSessionKey } = await import("../../src/shared/session.ts");

function jsonl(...entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function claudeProjectDirName(project) {
  return project.replace(/[/.]/g, "-");
}

function codexSessionFilePath(codexHome, sessionId) {
  const timestamp = Number.parseInt(sessionId.replace(/-/g, "").slice(0, 12), 16);
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return path.join(
    codexHome,
    "sessions",
    year,
    month,
    day,
    `rollout-${year}-${month}-${day}T${hour}-${minute}-${second}-${sessionId}.jsonl`,
  );
}

const codexSessionId = "019e5862-8776-7723-8de9-3460e9600119";
const claudeProjectDir = path.join(claudeDir, "projects", claudeProjectDirName(staleProject));
fs.mkdirSync(claudeProjectDir, { recursive: true });
fs.writeFileSync(
  path.join(claudeProjectDir, "claude-1.jsonl"),
  jsonl(
    {
      type: "assistant",
      sessionId: "claude-1",
      timestamp: "2026-05-24T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "old claude assistant message" }],
      },
    },
    {
      type: "assistant",
      sessionId: "claude-1",
      timestamp: "2026-05-24T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "new claude assistant message" }],
      },
    },
  ),
);

const codexSessionFile = codexSessionFilePath(codexDir, codexSessionId);
fs.mkdirSync(path.dirname(codexSessionFile), { recursive: true });
fs.writeFileSync(
  codexSessionFile,
  jsonl(
    {
      type: "session_meta",
      timestamp: "2026-05-24T00:00:00.000Z",
      payload: {
        id: codexSessionId,
        cwd: staleProject,
      },
    },
    {
      type: "response_item",
      timestamp: "2026-05-24T00:00:01.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "old codex assistant message" }],
      },
    },
    {
      type: "response_item",
      timestamp: "2026-05-24T00:00:02.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "new codex assistant message" }],
      },
    },
  ),
);

const kimiSessionId = "session_kimi-1";
const kimiSessionDir = path.join(
  kimiDir,
  "sessions",
  "wd_missing-worktree_000000000000",
  kimiSessionId,
);
fs.mkdirSync(path.join(kimiSessionDir, "agents", "main"), { recursive: true });
fs.writeFileSync(
  path.join(kimiDir, "session_index.jsonl"),
  `${JSON.stringify({
    sessionId: kimiSessionId,
    sessionDir: kimiSessionDir,
    workDir: staleProject,
  })}\n`,
);
fs.writeFileSync(
  path.join(kimiSessionDir, "state.json"),
  JSON.stringify({
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:02.000Z",
    title: "kimi session title",
    lastPrompt: "kimi last prompt",
    workDir: staleProject,
  }),
);

test.after(() => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousKimiCodeHome === undefined) {
    delete process.env.KIMI_CODE_HOME;
  } else {
    process.env.KIMI_CODE_HOME = previousKimiCodeHome;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("loadStoredSessionPreviews は stored session の preview を key で返す", async () => {
  const previews = await loadStoredSessionPreviews();

  assert.equal(previews.get(toSessionKey("claude", "claude-1")), "new claude assistant message");
  assert.equal(previews.get(toSessionKey("codex", codexSessionId)), "new codex assistant message");
  assert.equal(previews.get(toSessionKey("kimi", kimiSessionId)), "kimi last prompt");
  assert.equal(previews.has(toSessionKey("claude", missingClaudeSessionId)), false);
});

test("loadStoredSessionPreview は指定 session の preview だけを返す", async () => {
  fs.writeFileSync(
    path.join(codexDir, "history.jsonl"),
    jsonl(
      { session_id: codexSessionId, text: "history should not be used", ts: 1 },
      { session_id: "codex-2", text: "other codex message", ts: 3 },
    ),
  );

  assert.equal(await loadStoredSessionPreview("claude", "claude-1"), "new claude assistant message");
  assert.equal(await loadStoredSessionPreview("claude", missingClaudeSessionId), null);
  assert.equal(await loadStoredSessionPreview("codex", codexSessionId), "new codex assistant message");
  assert.equal(await loadStoredSessionPreview("codex", "missing"), null);
  assert.equal(await loadStoredSessionPreview("kimi", kimiSessionId), "kimi last prompt");
  assert.equal(await loadStoredSessionPreview("kimi", "missing"), null);
});

test("loadStoredSessionPreview は Claude/Codex session への追記を反映する", async () => {
  fs.appendFileSync(
    path.join(claudeProjectDir, "claude-1.jsonl"),
    jsonl({
      type: "assistant",
      sessionId: "claude-1",
      timestamp: "2026-05-24T00:00:03.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "appended claude assistant message" }],
      },
    }),
  );
  fs.appendFileSync(
    codexSessionFile,
    jsonl({
      type: "response_item",
      timestamp: "2026-05-24T00:00:03.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "appended codex assistant message" }],
      },
    }),
  );

  assert.equal(
    await loadStoredSessionPreview("claude", "claude-1"),
    "appended claude assistant message",
  );
  assert.equal(
    await loadStoredSessionPreview("codex", codexSessionId),
    "appended codex assistant message",
  );
});

test("Claude stored session の存在判定は session file の存在を見る", async () => {
  assert.equal(await claudeProvider.hasStoredSession("claude-1"), true);
  assert.equal(await claudeProvider.hasStoredSession(missingClaudeSessionId), false);
});

test("provider resume launch は session の記録場所 (target.cwd) で起動する", async () => {
  const repoRoot = path.join(tempDir, "repo");
  const worktreePath = path.join(repoRoot, ".yuru", "worktrees", "task-a");

  assert.deepEqual(
    await claudeProvider.createResumeLaunch({
      provider: "claude",
      providerSessionId: "claude-resume",
      cwd: worktreePath,
      project: worktreePath,
    }),
    {
      cwd: worktreePath,
      args: ["--resume", "claude-resume"],
      worktreePath,
    },
  );
  assert.deepEqual(
    await codexProvider.createResumeLaunch({
      provider: "codex",
      providerSessionId: "codex-resume",
      cwd: worktreePath,
      project: worktreePath,
    }),
    {
      cwd: worktreePath,
      args: ["resume", "--all", "codex-resume"],
      worktreePath,
    },
  );
  assert.deepEqual(
    await kimiProvider.createResumeLaunch({
      provider: "kimi",
      providerSessionId: "session_kimi-resume",
      cwd: repoRoot,
      project: repoRoot,
    }),
    {
      cwd: repoRoot,
      args: ["--session", "session_kimi-resume"],
      worktreePath: repoRoot,
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
    `When mentioning files in messages, use either paths relative to ${worktreePath} or absolute paths. Never use paths relative to ${repoPath}. ` +
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

  const kimiLaunch = await kimiProvider.createWorktreeLaunch(context);
  assert.equal(kimiLaunch.cwd, repoPath);
  assert.deepEqual(kimiLaunch.args, []);
  assert.equal(kimiLaunch.worktreePath, worktreePath);
  assert.equal(kimiLaunch.initialInput, prompt);
  assert.ok(kimiLaunch.existingProviderSessionIds instanceof Set);
  assert.ok(kimiLaunch.existingProviderSessionIds.has(kimiSessionId));
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
    { provider: "claude", providerSessionId: "claude-a", cwd: worktreeA, timestamp: 0 },
    { provider: "claude", providerSessionId: "claude-b", cwd: worktreeA, timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-a", cwd: path.join(worktreeA, "src"), timestamp: 0 },
  ]);
  assert.deepEqual(suggestions.get(worktreeB), [
    { provider: "claude", providerSessionId: "claude-a", cwd: worktreeB, timestamp: 0 },
    { provider: "codex", providerSessionId: "codex-b", cwd: path.join(tempDir, "repo"), timestamp: 0 },
  ]);
});

test("loadSuggestedWorktreeSessions は 10MB を超える検索結果でも session を返す", async () => {
  const worktreePath = path.join(tempDir, "large-output-repo", ".yuru", "worktrees", "task-a");
  const codexSessionsDir = path.join(codexDir, "sessions", "2026", "05", "10");
  fs.mkdirSync(codexSessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexSessionsDir, "large-output.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          id: "codex-large-output",
          cwd: path.join(tempDir, "large-output-repo"),
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          cwd: worktreePath,
          output: "x".repeat(10 * 1024 * 1024),
        },
      },
    ),
  );

  const suggestions = await loadSuggestedWorktreeSessions([worktreePath]);

  assert.deepEqual(suggestions.get(worktreePath), [
    {
      provider: "codex",
      providerSessionId: "codex-large-output",
      cwd: path.join(tempDir, "large-output-repo"),
      timestamp: 0,
    },
  ]);
});

test("loadSuggestedWorktreeSessions は PATH に rg が無くても失敗しない", async () => {
  const previousPath = process.env.PATH;
  const emptyBinDir = path.join(tempDir, "empty-bin");
  const worktreePath = path.join(tempDir, "repo-rg-required", ".yuru", "worktrees", "task-a");
  fs.mkdirSync(emptyBinDir, { recursive: true });
  fs.mkdirSync(path.join(claudeDir, "projects", "rg-required"), { recursive: true });

  process.env.PATH = emptyBinDir;
  try {
    await assert.doesNotReject(() => loadSuggestedWorktreeSessions([worktreePath]));
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
    { provider: "codex", providerSessionId: "codex-meta", cwd: worktreePath, timestamp: 0 },
    {
      provider: "codex",
      providerSessionId: "codex-patch",
      cwd: path.join(tempDir, "repo"),
      timestamp: 0,
    },
    {
      provider: "codex",
      providerSessionId: "codex-workdir",
      cwd: path.join(tempDir, "repo"),
      timestamp: 0,
    },
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
    cwd: repoPath,
    timestamp: Date.parse("2026-05-10T00:00:02.000Z"),
  });
});
