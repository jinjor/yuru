import { expect, test, type ElectronApplication } from "@playwright/test";
import { execFile } from "node:child_process";
import { appendFile, chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  createGitWorktree,
  launchWindow,
  readMetadata,
  registerRepo,
  visibleWorktreeView,
  worktreeCard,
} from "./helpers";

const execFileAsync = promisify(execFile);
const FIRST_SESSION_ID = "019e5862-8776-7723-8de9-3460e9600119";
const SECOND_SESSION_ID = "019e5862-8776-7723-8de9-3460e9600120";
const SUGGESTED_SESSION_ID = "019e5862-8776-7723-8de9-3460e9600121";

test("ホームは空の session セクションを表示しない", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const emptyWorktreePath = await createGitWorktree(context, repoDir, "empty-session-home");
    const primaryWorktreePath = await createGitWorktree(context, repoDir, "primary-session-home");
    await registerRepo(context, repoDir, [
      { worktreePath: emptyWorktreePath, primarySessions: [] },
      {
        worktreePath: primaryWorktreePath,
        primarySessions: [{ provider: "codex", agentSessionId: FIRST_SESSION_ID }],
      },
    ]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    const sessionView = visibleWorktreeView(window);

    await worktreeCard(window, "empty-session-home").click();
    await expect(sessionView.locator(".action-surface-label")).toHaveText(["New session"]);

    await worktreeCard(window, "primary-session-home").click();
    await expect(sessionView.locator(".action-surface-label")).toHaveText([
      "Sessions",
      "New session",
    ]);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("ホームから複数 primary を操作し、suggested を promote できる", async () => {
  test.setTimeout(60_000);
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "session-home");
    await seedCodexStoredSession(
      context.tmpHome,
      worktreePath,
      FIRST_SESSION_ID,
      "First primary session",
    );
    await seedCodexStoredSession(
      context.tmpHome,
      worktreePath,
      SECOND_SESSION_ID,
      "Second primary session",
    );
    await seedCodexStoredSession(
      context.tmpHome,
      worktreePath,
      SUGGESTED_SESSION_ID,
      "Suggested session to promote",
    );
    await registerRepo(context, repoDir, [
      {
        worktreePath,
        primarySessions: [
          { provider: "codex", agentSessionId: FIRST_SESSION_ID },
          { provider: "codex", agentSessionId: SECOND_SESSION_ID },
        ],
      },
    ]);
    const fakeBin = await createFakeCodexBin(context.tmpHome);
    const launched = await launchWindow(context, {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
    });
    app = launched.app;
    const window = launched.window;
    const sessionView = visibleWorktreeView(window);
    await worktreeCard(window, "session-home").click();

    const primaryRows = sessionView.locator(".session-home-row");
    await expect(primaryRows).toHaveCount(2);
    await expect(primaryRows.nth(0)).toContainText("First primary session");
    await expect(primaryRows.nth(1)).toContainText("Second primary session");
    await expect(sessionView.locator(".suggested-session-action")).toContainText(
      "Suggested session to promote",
    );
    await expect(sessionView.locator(".action-surface-label")).toHaveText([
      "Sessions",
      "Suggested",
      "New session",
    ]);

    // detach は inactive primary 行の副操作であり、他の primary は残る。
    await primaryRows.nth(1).locator(".detach-primary-action").click();
    await expect(primaryRows).toHaveCount(1);
    expect((await readMetadata(context)).taskWorktrees[0].primarySessions).toEqual([
      { provider: "codex", agentSessionId: FIRST_SESSION_ID },
    ]);

    // inactive 行は resume して runtime タブを選ぶ。
    await primaryRows.nth(0).locator(".resume-primary-action").click();
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID, {
      timeout: 10_000,
    });
    await expect(
      sessionView.locator(".session-tab", { hasText: "First primary session" }),
    ).toHaveClass(/selected/);

    // active 行は resume せず、生きている runtime のタブを選ぶ。
    await sessionView.locator(".session-tab-home").click();
    const activePrimaryRow = sessionView.locator(".session-home-row", {
      hasText: "First primary session",
    });
    await expect(activePrimaryRow).toHaveClass(/active/);
    await activePrimaryRow.locator(".resume-primary-action").click();
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID);
    await expect(sessionView.locator(".session-tab:not(.session-tab-home)")).toHaveCount(1);

    // suggested は primary に昇格して resume され、新しいタブが選択される。
    await sessionView.locator(".session-tab-home").click();
    await sessionView
      .locator(".suggested-session-action", { hasText: "Suggested session to promote" })
      .click();
    await expect(sessionView.locator(".xterm")).toContainText(SUGGESTED_SESSION_ID, {
      timeout: 10_000,
    });
    await expect(sessionView.locator(".session-tab:not(.session-tab-home)")).toHaveCount(2);
    expect((await readMetadata(context)).taskWorktrees[0].primarySessions).toEqual([
      { provider: "codex", agentSessionId: FIRST_SESSION_ID },
      {
        provider: "codex",
        agentSessionId: SUGGESTED_SESSION_ID,
        cwd: worktreePath,
      },
    ]);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("複数 runtime をタブで切り替え、kill と exit 後はホームへ戻る", async () => {
  test.setTimeout(60_000);
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "session-tabs");
    const firstSessionFile = await seedCodexStoredSession(
      context.tmpHome,
      repoDir,
      FIRST_SESSION_ID,
      "Parent session with a deliberately long preview for the first runtime tab",
    );
    await seedCodexStoredSession(
      context.tmpHome,
      repoDir,
      SECOND_SESSION_ID,
      "Inactive second primary",
    );
    await registerRepo(context, repoDir, [
      {
        worktreePath,
        primarySessions: [
          { provider: "codex", agentSessionId: FIRST_SESSION_ID },
          { provider: "codex", agentSessionId: SECOND_SESSION_ID },
        ],
      },
    ]);
    const fakeBin = await createFakeCodexBin(context.tmpHome);
    const testPath = `${fakeBin}:${process.env.PATH ?? ""}`;

    const launched = await launchWindow(context, { env: { PATH: testPath } });
    app = launched.app;
    const window = launched.window;
    const sessionView = visibleWorktreeView(window);
    await worktreeCard(window, "session-tabs").click();

    const homeTab = sessionView.locator(".session-tab-home");
    await expect(homeTab).toHaveClass(/selected/);
    await expect(sessionView.locator(".terminal-session-start")).toBeVisible();
    await expect(sessionView.locator(".session-tab:not(.session-tab-home)")).toHaveCount(0);

    // Yuru 内で resume した runtime はタブへ追加され、そのまま選択される。
    await sessionView
      .locator(".session-home-row", { hasText: "Parent session" })
      .locator(".resume-primary-action")
      .click();
    const firstTab = sessionView.locator(".session-tab", { hasText: "Parent session" });
    await expect(firstTab).toHaveClass(/selected/);
    await expect(firstTab.locator('[aria-label^="Codex primary session active"]')).toBeVisible();
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID, {
      timeout: 10_000,
    });

    // session push は runtime id 単位でタブの preview / activity に反映される。
    const updatedPreview = "Updated parent preview from session push";
    await appendFile(
      firstSessionFile,
      `${JSON.stringify({
        type: "response_item",
        timestamp: new Date().toISOString(),
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: updatedPreview }],
        },
      })}\n`,
    );
    const firstRuntimeId = await window.evaluate(async () => {
      const repo = (await window.electronAPI.getRepos())[0];
      const worktree = repo?.taskWorktrees.find((entry) => entry.name === "session-tabs");
      const runtimeId = worktree?.primarySessions[0]?.activeTerminalRuntimeId;
      if (!runtimeId) {
        throw new Error("First runtime was not active");
      }
      return runtimeId;
    });
    await app.evaluate(
      ({ BrowserWindow }, update) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("session:changed", update.runtimeId, {
          preview: update.preview,
          activityState: "working",
        });
      },
      { runtimeId: firstRuntimeId, preview: updatedPreview },
    );
    const updatedFirstTab = sessionView.locator(".session-tab", { hasText: updatedPreview });
    await expect(updatedFirstTab).toBeVisible();
    await expect(updatedFirstTab.locator(".session-provider-dot.activity-working")).toBeVisible();

    // API からの create は runtime タブだけを増やし、現在タブは変えない。fake Codex は
    // session id を保存しないので、設計上の lazy-provider fallback ラベルも同時に確認する。
    const socketPath = await findApiSocket(context.yuruHome);
    await execFileAsync(
      process.execPath,
      [
        path.join(context.repoRoot, "scripts/yuru-cli/index.mjs"),
        "session",
        "create",
        "--worktree",
        worktreePath,
        "--provider",
        "codex",
        "--prompt",
        "SECOND_RUNTIME",
      ],
      {
        cwd: context.repoRoot,
        env: {
          ...process.env,
          HOME: context.tmpHome,
          PATH: testPath,
          YURU_API_SOCKET: socketPath,
          YURU_HOME: context.yuruHome,
        },
      },
    );

    const runtimeTabs = sessionView.locator(".session-tab:not(.session-tab-home)");
    await expect(runtimeTabs).toHaveCount(2);
    await expect(updatedFirstTab).toHaveClass(/selected/);
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID);
    await expect(sessionView.locator(".xterm")).not.toContainText("SECOND_RUNTIME");

    const secondTab = runtimeTabs.filter({ hasText: "Terminal" });
    await secondTab.click();
    await expect(secondTab).toHaveClass(/selected/);
    await expect(sessionView.locator(".xterm")).toContainText("SECOND_RUNTIME", {
      timeout: 10_000,
    });

    await updatedFirstTab.click();
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID);

    // 裏の runtime を閉じても表示中タブは変わらない。
    await secondTab.locator(".session-tab-close").click();
    await expect(runtimeTabs).toHaveCount(1, { timeout: 10_000 });
    await expect(updatedFirstTab).toHaveClass(/selected/);
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID);

    // 表示中 runtime を閉じるとタブが消え、provider session を残したままホームへ戻る。
    await updatedFirstTab.locator(".session-tab-close").click();
    await expect(runtimeTabs).toHaveCount(0, { timeout: 10_000 });
    await expect(homeTab).toHaveClass(/selected/);
    await expect(sessionView.locator(".terminal-session-start")).toBeVisible();
    await expect(sessionView.locator(".xterm")).toHaveCount(0);
    await expect(
      sessionView.locator(".resume-primary-action", { hasText: updatedPreview }),
    ).toBeVisible();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

async function createFakeCodexBin(home: string): Promise<string> {
  const binDir = path.join(home, "fake-bin");
  const executablePath = path.join(binDir, "codex");
  await mkdir(binDir, { recursive: true });
  await writeFile(
    executablePath,
    [
      "#!/usr/bin/env node",
      'process.stdout.write(`FAKE_CODEX ${process.argv.slice(2).join(" ")}\\n`);',
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"),
  );
  await chmod(executablePath, 0o755);
  return binDir;
}

async function seedCodexStoredSession(
  home: string,
  cwd: string,
  sessionId: string,
  preview: string,
): Promise<string> {
  const timestamp = Number.parseInt(sessionId.replace(/-/g, "").slice(0, 12), 16);
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const sessionFile = path.join(
    home,
    ".codex",
    "sessions",
    year,
    month,
    day,
    `rollout-${sessionId}.jsonl`,
  );
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await writeFile(
    sessionFile,
    [
      JSON.stringify({
        type: "session_meta",
        timestamp: new Date(timestamp).toISOString(),
        payload: { id: sessionId, cwd },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: new Date(timestamp + 1).toISOString(),
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: preview }],
        },
      }),
      "",
    ].join("\n"),
  );
  return sessionFile;
}

async function findApiSocket(yuruHome: string): Promise<string> {
  const runDir = path.join(yuruHome, "run");
  await expect
    .poll(async () => (await readdir(runDir)).filter((name) => name.endsWith(".sock")))
    .toHaveLength(1);
  const socketName = (await readdir(runDir)).find((name) => name.endsWith(".sock"));
  if (!socketName) {
    throw new Error("Yuru API socket was not found");
  }
  return path.join(runDir, socketName);
}
