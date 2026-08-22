import { expect, test, type ElectronApplication } from "@playwright/test";
import { execFile } from "node:child_process";
import { appendFile, chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
const LAZY_SESSION_ID = "019e5862-8776-7723-8de9-3460e9600122";
const THIRD_SESSION_ID = "019e5862-8776-7723-8de9-3460e9600123";

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

test("同じ inactive session を同時に resume しても runtime は 1 件だけ起動する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "single-session-runtime");
    await seedCodexStoredSession(
      context.tmpHome,
      repoDir,
      FIRST_SESSION_ID,
      "Concurrent resume target",
    );
    await registerRepo(context, repoDir, [
      {
        worktreePath,
        primarySessions: [{ provider: "codex", agentSessionId: FIRST_SESSION_ID, cwd: repoDir }],
      },
    ]);
    const fakeBin = await createFakeCodexBin(context.tmpHome);
    const launched = await launchWindow(context, {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
    });
    app = launched.app;
    const window = launched.window;
    await expect(worktreeCard(window, "single-session-runtime")).toBeVisible();
    const worktreeId = await window.evaluate(async () => {
      const worktree = (await window.electronAPI.getRepos())[0]?.taskWorktrees.find(
        (entry) => entry.name === "single-session-runtime",
      );
      if (!worktree) {
        throw new Error("The task worktree was not listed");
      }
      return worktree.worktreeId;
    });

    const results = await window.evaluate(
      ({ targetWorktreeId, agentSessionKey }) =>
        Promise.all([
          window.electronAPI.resumePrimarySession(targetWorktreeId, agentSessionKey),
          window.electronAPI.resumePrimarySession(targetWorktreeId, agentSessionKey),
        ]),
      { targetWorktreeId: worktreeId, agentSessionKey: `codex:${FIRST_SESSION_ID}` },
    );
    const succeeded = results.filter((result) => result.ok);
    const rejected = results.filter((result) => !result.ok);
    expect(succeeded.length).toBeGreaterThan(0);
    expect(new Set(succeeded.map((result) => result.data.terminalRuntimeId)).size).toBe(1);
    for (const result of rejected) {
      expect(result.error).toEqual({
        code: "command_failed",
        message: "This session is already starting.",
      });
    }
    const started = succeeded[0];
    if (!started?.ok) {
      throw new Error("No concurrent resume request succeeded");
    }

    const worktree = await window.evaluate(async (targetWorktreeId) => {
      const repos = await window.electronAPI.getRepos();
      return repos[0]?.taskWorktrees.find((entry) => entry.worktreeId === targetWorktreeId);
    }, worktreeId);
    expect(worktree?.activeTerminalRuntimeIds).toEqual([started.data.terminalRuntimeId]);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("Codex の session ID 確定中も runtime タブは worktree から消えない", async () => {
  test.setTimeout(30_000);
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "lazy-session-route");
    await registerRepo(context, repoDir, [{ worktreePath }]);
    const fakeBin = await createFakeCodexBin(context.tmpHome, {
      agentSessionId: LAZY_SESSION_ID,
      cwd: repoDir,
    });
    const launched = await launchWindow(context, {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
    });
    app = launched.app;
    const window = launched.window;
    await expect(worktreeCard(window, "lazy-session-route")).toBeVisible();
    const worktreeId = await window.evaluate(async () => {
      const worktree = (await window.electronAPI.getRepos())[0]?.taskWorktrees.find(
        (entry) => entry.name === "lazy-session-route",
      );
      if (!worktree) {
        throw new Error("The task worktree was not listed");
      }
      return worktree.worktreeId;
    });
    const started = await window.evaluate(
      (targetWorktreeId) => window.electronAPI.createSessionForWorktree(targetWorktreeId, "codex"),
      worktreeId,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      throw new Error("Codex session failed to start");
    }

    const transition = await window.evaluate(
      async ({ targetWorktreeId, resolvedSessionKey }) => {
        const snapshots: Array<{
          activeTerminalRuntimeIds: string[];
          primarySessionKeys: Array<string | null>;
        }> = [];
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          const worktree = (await window.electronAPI.getRepos())[0]?.taskWorktrees.find(
            (entry) => entry.worktreeId === targetWorktreeId,
          );
          if (!worktree) {
            throw new Error("The task worktree disappeared during session ID resolution");
          }
          snapshots.push({
            activeTerminalRuntimeIds: worktree.activeTerminalRuntimeIds,
            primarySessionKeys: worktree.primarySessions.map((session) => session.agentSessionKey),
          });
          if (
            worktree.primarySessions.some(
              (session) => session.agentSessionKey === resolvedSessionKey,
            )
          ) {
            return { resolved: true, snapshots };
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return { resolved: false, snapshots };
      },
      {
        targetWorktreeId: worktreeId,
        resolvedSessionKey: `codex:${LAZY_SESSION_ID}`,
      },
    );

    expect(transition.resolved).toBe(true);
    expect(transition.snapshots[0]?.primarySessionKeys).toEqual([null]);
    expect(transition.snapshots.at(-1)?.primarySessionKeys).toEqual([`codex:${LAZY_SESSION_ID}`]);
    for (const snapshot of transition.snapshots) {
      expect(snapshot.activeTerminalRuntimeIds).toContain(started.data.terminalRuntimeId);
    }
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("active suggested を promote すると既存 runtime のタブが移動先 worktree に移る", async () => {
  test.setTimeout(90_000);
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreeAPath = await createGitWorktree(context, repoDir, "session-route-a");
    const worktreeBPath = await createGitWorktree(context, repoDir, "session-route-b");
    const sessionFile = await seedCodexStoredSession(
      context.tmpHome,
      repoDir,
      FIRST_SESSION_ID,
      "Active session moving between worktrees",
    );
    const commandEvidence = (worktreePath: string) =>
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: {
            type: "CommandExecution",
            cwd: pathToFileURL(worktreePath).href,
          },
        },
      });
    await appendFile(
      sessionFile,
      `${commandEvidence(worktreeAPath)}\n${commandEvidence(worktreeBPath)}\n`,
    );
    await registerRepo(context, repoDir, [
      {
        worktreePath: worktreeAPath,
        // Yuru が起動する provider session の PTY は repo root で動き、session log の
        // command evidence が実際の作業先 A / B を示す。
        primarySessions: [{ provider: "codex", agentSessionId: FIRST_SESSION_ID, cwd: repoDir }],
      },
      { worktreePath: worktreeBPath },
    ]);
    const fakeBin = await createFakeCodexBin(context.tmpHome);
    const launched = await launchWindow(context, {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
    });
    app = launched.app;
    const window = launched.window;
    const sessionView = visibleWorktreeView(window);

    await worktreeCard(window, "session-route-a").click();
    await sessionView
      .locator(".session-home-row", { hasText: "Active session moving between worktrees" })
      .locator(".resume-primary-action")
      .click();
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID, {
      timeout: 10_000,
    });
    const runtimeId = await window.evaluate(async () => {
      const repo = (await window.electronAPI.getRepos())[0];
      const worktree = repo?.taskWorktrees.find((entry) => entry.name === "session-route-a");
      const activeRuntimeId = worktree?.primarySessions[0]?.activeTerminalRuntimeId;
      if (!activeRuntimeId) {
        throw new Error("The primary session runtime was not active");
      }
      return activeRuntimeId;
    });

    await worktreeCard(window, "session-route-b").click();
    await expect(sessionView.locator(".session-tab:not(.session-tab-home)")).toHaveCount(0);
    const suggestedRow = sessionView.locator(".suggested-session-action", {
      hasText: "Active session moving between worktrees",
    });
    await expect(suggestedRow).toContainText("active");

    await suggestedRow.click();
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID);
    await expect(
      sessionView.locator(".session-tab", {
        hasText: "Active session moving between worktrees",
      }),
    ).toHaveClass(/selected/);

    const reposAfterPromote = await window.evaluate(() => window.electronAPI.getRepos());
    const taskWorktrees = reposAfterPromote[0]?.taskWorktrees ?? [];
    const worktreeA = taskWorktrees.find((entry) => entry.name === "session-route-a");
    const worktreeB = taskWorktrees.find((entry) => entry.name === "session-route-b");
    expect(worktreeA?.activeTerminalRuntimeIds).not.toContain(runtimeId);
    expect(worktreeA?.primarySessions).toHaveLength(0);
    expect(worktreeB?.activeTerminalRuntimeIds).toEqual([runtimeId]);
    expect(worktreeB?.primarySessions[0]?.activeTerminalRuntimeId).toBe(runtimeId);

    await worktreeCard(window, "session-route-a").click();
    await expect(sessionView.locator(".session-tab:not(.session-tab-home)")).toHaveCount(0);
    await expect(sessionView.locator(".session-home-row")).toHaveCount(0);

    expect((await readMetadata(context)).taskWorktrees).toEqual([
      {
        repoId: expect.any(String),
        worktreePath: worktreeAPath,
        primarySessions: [],
      },
      {
        repoId: expect.any(String),
        worktreePath: worktreeBPath,
        primarySessions: [
          {
            provider: "codex",
            agentSessionId: FIRST_SESSION_ID,
            cwd: repoDir,
          },
        ],
      },
    ]);

    await window.evaluate(() => {
      const trackedWindow = window as Window & { __yuruExitedRuntimeIds?: string[] };
      trackedWindow.__yuruExitedRuntimeIds = [];
      window.electronAPI.onTerminalRuntimeExited((terminalRuntimeId) => {
        trackedWindow.__yuruExitedRuntimeIds?.push(terminalRuntimeId);
      });
    });

    const worktreeACard = worktreeCard(window, "session-route-a");
    await worktreeACard.hover();
    await worktreeACard.locator(".task-worktree-overflow").click();
    await worktreeACard.locator(".task-worktree-menu-item").click();
    await window.locator(".removal-foot .button.danger").click();
    await expect(worktreeACard).toHaveCount(0);
    expect(
      await window.evaluate(
        () =>
          (window as Window & { __yuruExitedRuntimeIds?: string[] }).__yuruExitedRuntimeIds ?? [],
      ),
    ).not.toContain(runtimeId);

    await worktreeCard(window, "session-route-b").click();
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID);

    const worktreeBCard = worktreeCard(window, "session-route-b");
    await worktreeBCard.hover();
    await worktreeBCard.locator(".task-worktree-overflow").click();
    await worktreeBCard.locator(".task-worktree-menu-item").click();
    await window.locator(".removal-foot .button.danger").click();
    await expect(worktreeBCard).toHaveCount(0);
    await expect
      .poll(() =>
        window.evaluate(
          () =>
            (window as Window & { __yuruExitedRuntimeIds?: string[] }).__yuruExitedRuntimeIds ?? [],
        ),
      )
      .toContain(runtimeId);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("session を再開してもタブはホームと同じ primary session 順を保つ", async () => {
  test.setTimeout(60_000);
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "stable-session-tab-order");
    await seedCodexStoredSession(context.tmpHome, repoDir, FIRST_SESSION_ID, "First session");
    await seedCodexStoredSession(context.tmpHome, repoDir, SECOND_SESSION_ID, "Second session");
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
    await worktreeCard(window, "stable-session-tab-order").click();

    const homeTab = sessionView.locator(".session-tab-home");
    const primaryRows = sessionView.locator(".session-home-row");
    await expect(primaryRows.locator(".action-surface-row-main")).toHaveText([
      "First session",
      "Second session",
    ]);

    await primaryRows.nth(0).locator(".resume-primary-action").click();
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID, {
      timeout: 10_000,
    });
    await homeTab.click();
    await primaryRows.nth(1).locator(".resume-primary-action").click();
    await expect(sessionView.locator(".xterm")).toContainText(SECOND_SESSION_ID, {
      timeout: 10_000,
    });

    const runtimeTabs = sessionView.locator(".session-tab:not(.session-tab-home)");
    await expect(runtimeTabs.locator(".session-tab-label")).toHaveText([
      "First session",
      "Second session",
    ]);

    await runtimeTabs.nth(0).locator(".session-tab-close").click();
    await expect(runtimeTabs.locator(".session-tab-label")).toHaveText(["Second session"]);
    await homeTab.click();
    await primaryRows.nth(0).locator(".resume-primary-action").click();
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID, {
      timeout: 10_000,
    });

    await expect(runtimeTabs.locator(".session-tab-label")).toHaveText([
      "First session",
      "Second session",
    ]);
    await homeTab.click();
    await expect(primaryRows.locator(".action-surface-row-main")).toHaveText([
      "First session",
      "Second session",
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

test("タブをドラッグすると primary session の並びが変わり metadata にも保存される", async () => {
  test.setTimeout(60_000);
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "session-tab-order");
    await seedCodexStoredSession(context.tmpHome, repoDir, FIRST_SESSION_ID, "First session");
    await seedCodexStoredSession(context.tmpHome, repoDir, SECOND_SESSION_ID, "Second session");
    await seedCodexStoredSession(context.tmpHome, repoDir, THIRD_SESSION_ID, "Third session");
    await registerRepo(context, repoDir, [
      {
        worktreePath,
        primarySessions: [
          { provider: "codex", agentSessionId: FIRST_SESSION_ID },
          { provider: "codex", agentSessionId: SECOND_SESSION_ID },
          { provider: "codex", agentSessionId: THIRD_SESSION_ID },
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
    await worktreeCard(window, "session-tab-order").click();

    // 3 つの primary のうち 1 番目と 3 番目だけ resume する。2 番目は inactive なので
    // タブには出ず、タブ列の並びだけでは置き場所が決まらない。
    const homeTab = sessionView.locator(".session-tab-home");
    const primaryRows = sessionView.locator(".session-home-row");
    await primaryRows.nth(0).locator(".resume-primary-action").click();
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID, {
      timeout: 10_000,
    });
    await homeTab.click();
    await primaryRows.nth(2).locator(".resume-primary-action").click();
    await expect(sessionView.locator(".xterm")).toContainText(THIRD_SESSION_ID, {
      timeout: 10_000,
    });

    const runtimeTabs = sessionView.locator(".session-tab:not(.session-tab-home)");
    await expect(runtimeTabs.locator(".session-tab-label")).toHaveText([
      "First session",
      "Third session",
    ]);
    const firstTab = runtimeTabs.filter({ hasText: "First session" });
    await firstTab.click();
    await expect(firstTab).toHaveClass(/selected/);

    const firstTabBox = await firstTab.boundingBox();
    const thirdTab = runtimeTabs.filter({ hasText: "Third session" });
    const thirdTabBox = await thirdTab.boundingBox();
    expect(firstTabBox).not.toBeNull();
    expect(thirdTabBox).not.toBeNull();
    const startY = thirdTabBox!.y + thirdTabBox!.height / 2;
    await window.mouse.move(thirdTabBox!.x + thirdTabBox!.width / 2, startY);
    await window.mouse.down();
    // 先頭のタブの位置まで左へ動かすと、その手前 (タブ列の左端) に落ちる。
    await window.mouse.move(firstTabBox!.x + firstTabBox!.width / 2, startY, { steps: 8 });
    await window.mouse.up();

    await expect(runtimeTabs.locator(".session-tab-label")).toHaveText([
      "Third session",
      "First session",
    ]);
    // 並び替えは表示中のタブを変えない。
    await expect(firstTab).toHaveClass(/selected/);

    // タブ列の左端は全体の先頭。タブに出ていない 2 番目の session は動かない。
    await homeTab.click();
    await expect(primaryRows.locator(".action-surface-row-main")).toHaveText([
      "Third session",
      "First session",
      "Second session",
    ]);
    await expect
      .poll(async () =>
        (await readMetadata(context)).taskWorktrees[0].primarySessions.map(
          (session) => session.agentSessionId,
        ),
      )
      .toEqual([THIRD_SESSION_ID, FIRST_SESSION_ID, SECOND_SESSION_ID]);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("session の user・assistant message にある URL だけを Bookmarks に追加する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "conversation-bookmarks");
    const sessionFile = await seedCodexStoredSession(
      context.tmpHome,
      repoDir,
      FIRST_SESSION_ID,
      "Old assistant link http://127.0.0.1:1/from-old-assistant",
    );
    const appendedEntries = [
      {
        type: "response_item",
        timestamp: new Date().toISOString(),
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Assistant link http://127.0.0.1:1/from-assistant",
            },
          ],
        },
      },
      {
        type: "response_item",
        timestamp: new Date().toISOString(),
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "User link http://127.0.0.1:1/from-user" }],
        },
      },
      {
        type: "response_item",
        timestamp: new Date().toISOString(),
        payload: {
          type: "function_call_output",
          output: "Tool output http://127.0.0.1:1/from-tool",
        },
      },
      {
        type: "response_item",
        timestamp: new Date().toISOString(),
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "# AGENTS.md instructions for /repo\n" +
                "http://127.0.0.1:1/from-project-instructions",
            },
          ],
        },
      },
    ];
    await registerRepo(context, repoDir, [
      {
        worktreePath,
        primarySessions: [{ provider: "codex", agentSessionId: FIRST_SESSION_ID }],
      },
    ]);
    const fakeBin = await createFakeCodexBin(context.tmpHome, undefined, {
      filePath: sessionFile,
      entries: appendedEntries,
    });
    let launched = await launchWindow(context, {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
    });
    app = launched.app;
    let window = launched.window;
    let sessionView = visibleWorktreeView(window);
    await worktreeCard(window, "conversation-bookmarks").click();
    await sessionView.locator(".resume-primary-action").click();
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID, {
      timeout: 10_000,
    });

    await sessionView.locator(".panel-tabs .tab", { hasText: "Bookmarks" }).click();
    await expect(sessionView.locator(".bookmark-row")).toHaveCount(2, { timeout: 10_000 });
    await expect(sessionView.locator(".bookmarks-pane")).toContainText(
      "http://127.0.0.1:1/from-assistant",
    );
    await expect(sessionView.locator(".bookmarks-pane")).toContainText(
      "http://127.0.0.1:1/from-user",
    );
    await expect(sessionView.locator(".bookmarks-pane")).not.toContainText(
      "http://127.0.0.1:1/from-tool",
    );
    await expect(sessionView.locator(".bookmarks-pane")).not.toContainText(
      "http://127.0.0.1:1/from-project-instructions",
    );
    await expect(sessionView.locator(".bookmarks-pane")).not.toContainText(
      "http://127.0.0.1:1/from-old-assistant",
    );

    await app.evaluate(({ shell }) => {
      shell.openExternal = async () => {
        throw new Error("open failed for test");
      };
    });
    await sessionView
      .locator(".bookmark-row", { hasText: "http://127.0.0.1:1/from-user" })
      .locator(".bookmark-open")
      .click();
    await expect(window.getByRole("alert")).toContainText("Failed to open bookmark.");

    await sessionView
      .locator(".bookmark-row", { hasText: "http://127.0.0.1:1/from-assistant" })
      .getByRole("button", { name: "Remove bookmark" })
      .click();
    await expect(sessionView.locator(".bookmark-row")).toHaveCount(1);

    await closeYuru(app);
    app = null;
    await createFakeCodexBin(context.tmpHome);
    launched = await launchWindow(context, {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
    });
    app = launched.app;
    window = launched.window;
    sessionView = visibleWorktreeView(window);
    await worktreeCard(window, "conversation-bookmarks").click();
    await sessionView.locator(".resume-primary-action").click();
    await expect(sessionView.locator(".xterm")).toContainText(FIRST_SESSION_ID, {
      timeout: 10_000,
    });
    await sessionView.locator(".panel-tabs .tab", { hasText: "Bookmarks" }).click();
    await expect(sessionView.locator(".bookmark-row")).toHaveCount(1);
    await expect(sessionView.locator(".bookmarks-pane")).not.toContainText(
      "http://127.0.0.1:1/from-assistant",
    );
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

async function createFakeCodexBin(
  home: string,
  resolvedSession?: { agentSessionId: string; cwd: string },
  appendedSession?: { filePath: string; entries: unknown[] },
): Promise<string> {
  const binDir = path.join(home, "fake-bin");
  const executablePath = path.join(binDir, "codex");
  await mkdir(binDir, { recursive: true });
  const resolvedSessionLines: string[] = [];
  if (resolvedSession || appendedSession) {
    resolvedSessionLines.push('const fs = require("node:fs");');
  }
  if (resolvedSession) {
    const sessionFile = codexStoredSessionFile(home, resolvedSession.agentSessionId);
    await mkdir(path.dirname(sessionFile), { recursive: true });
    const sessionPayload = JSON.stringify({
      id: resolvedSession.agentSessionId,
      cwd: resolvedSession.cwd,
    });
    resolvedSessionLines.push(
      `setTimeout(() => fs.writeFileSync(${JSON.stringify(sessionFile)}, JSON.stringify({ type: "session_meta", timestamp: new Date().toISOString(), payload: ${sessionPayload} }) + "\\n"), 250);`,
    );
  }
  if (appendedSession) {
    const content = `${appendedSession.entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    resolvedSessionLines.push(
      `setTimeout(() => fs.appendFileSync(${JSON.stringify(appendedSession.filePath)}, ${JSON.stringify(content)}), 250);`,
    );
  }
  await writeFile(
    executablePath,
    [
      "#!/usr/bin/env node",
      ...resolvedSessionLines,
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
  const sessionFile = codexStoredSessionFile(home, sessionId);
  const timestamp = Number.parseInt(sessionId.replace(/-/g, "").slice(0, 12), 16);
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

function codexStoredSessionFile(home: string, sessionId: string): string {
  const timestamp = Number.parseInt(sessionId.replace(/-/g, "").slice(0, 12), 16);
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return path.join(home, ".codex", "sessions", year, month, day, `rollout-${sessionId}.jsonl`);
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
