import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createEmptyRepo,
  createE2eContext,
  createGitWorktree,
  git,
  gitOutput,
  launchWindow,
  readMetadata,
  registerRepo,
  seedClaudeStoredSession,
  visibleWorktreeView,
  worktreeCard,
  writeMetadata,
} from "./helpers";

test("repo 未登録なら空状態とセッション未選択メッセージが出る", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await expect(window.locator(".sidebar-section .empty-state")).toHaveText("No repositories");
    await expect(window.locator(".terminal-container .empty-state")).toContainText("Select a worktree");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("登録済み repo は名前と path と main terminal カードを表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await expect(window.locator(".repo-name")).toHaveText(path.basename(repoDir));
    await expect(window.locator(".repo-path")).toHaveText(repoDir);
    await expect(window.locator(".repo-row-new-btn")).toBeEnabled();

    const mainCard = worktreeCard(window, "terminal");
    await expect(mainCard).toContainText("main");
    await expect(mainCard).toContainText("terminal");
    const headCommittedAt =
      Number(gitOutput(["show", "-s", "--format=%ct", "HEAD"], repoDir).trim()) * 1000;
    await expect(mainCard.locator(".task-worktree-head-time")).toHaveText(
      formatHeadCommittedAt(headCommittedAt),
    );
    await expect(window.locator(".task-worktree-card")).toHaveCount(1);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

function formatHeadCommittedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

test("コミット無し repo は main worktree を no commits 表示にする", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createEmptyRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await expect(window.locator(".repo-name")).toHaveText(path.basename(repoDir));
    await expect(worktreeCard(window, "(no commits)")).toContainText("terminal");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("複数 repo を登録するとそれぞれの repo 行を表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const firstRepo = await createCommittedRepo(context);
    const secondRepo = await createCommittedRepo(context);
    await writeMetadata(context, {
      repos: [
        { id: "repo-1", repoPath: firstRepo },
        { id: "repo-2", repoPath: secondRepo },
      ],
      taskWorktrees: [],
    });
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await expect(window.locator(".repo-row")).toHaveCount(2);
    await expect(window.locator(".repo-path", { hasText: firstRepo })).toBeVisible();
    await expect(window.locator(".repo-path", { hasText: secondRepo })).toBeVisible();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("branch・detached・metadata 無しの task worktree を一覧表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const featurePath = await createGitWorktree(context, repoDir, "feature/list-row");
    await createGitWorktree(context, repoDir, "unused-detached-name", {
      detached: true,
      worktreeName: "detached-row",
    });
    const head = gitOutput(["rev-parse", "--short=7", "HEAD"], repoDir).trim();
    await registerRepo(context, repoDir);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    const featureCard = worktreeCard(window, "feature/list-row");
    await expect(featureCard).toBeVisible();
    await expect(featureCard.locator(".task-worktree-branch-icon")).toBeVisible();
    await expect(featureCard).toContainText("empty");
    await expect(featureCard).toHaveAttribute("title", featurePath);
    await expect(worktreeCard(window, `detached @ ${head}`)).toBeVisible();
    await expect(window.locator(".task-worktree-card")).toHaveCount(3);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("task worktree を path の辞書順ではなく作成順で表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreesDir = await mkdtemp(path.join(tmpdir(), "yuru-e2e-ordered-worktrees-"));
    context.addCleanupDir(worktreesDir);
    for (const branch of ["z-created-first", "a-created-second", "m-created-third"]) {
      git(["worktree", "add", "-b", branch, path.join(worktreesDir, branch)], repoDir);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await registerRepo(context, repoDir);

    const launched = await launchWindow(context);
    app = launched.app;

    await expect(launched.window.locator(".task-worktree-name")).toHaveText([
      "main",
      "z-created-first",
      "a-created-second",
      "m-created-third",
    ]);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("provider store から primary と suggested Claude session の概要を表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const primaryPath = await createGitWorktree(context, repoDir, "primary-row");
    const suggestedPath = await createGitWorktree(context, repoDir, "suggested-row");
    const primarySessionId = await seedClaudeStoredSession(context.tmpHome, {
      project: primaryPath,
      preview: "Primary preview from store",
    });
    await seedClaudeStoredSession(context.tmpHome, {
      project: suggestedPath,
      preview: "Suggested preview from store",
      cwdEvidence: suggestedPath,
    });
    await registerRepo(context, repoDir, [
      {
        worktreePath: primaryPath,
        primarySessions: [{ provider: "claude", agentSessionId: primarySessionId }],
      },
    ]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    const primaryCard = worktreeCard(window, "Primary preview from store");
    await expect(
      primaryCard.locator('[aria-label="Claude primary session inactive"]'),
    ).toBeVisible();

    const suggestedCard = worktreeCard(window, "1 existing session");
    await expect(suggestedCard).toContainText("suggested-row");
    await suggestedCard.click();
    await expect(visibleWorktreeView(window).locator(".suggested-session-action")).toContainText(
      "Suggested preview from store",
    );
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("suggested session が複数ある worktree は件数を表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "many-suggestions");
    await seedClaudeStoredSession(context.tmpHome, {
      project: worktreePath,
      preview: "First suggested preview",
      cwdEvidence: worktreePath,
    });
    await seedClaudeStoredSession(context.tmpHome, {
      project: worktreePath,
      preview: "Second suggested preview",
      cwdEvidence: worktreePath,
    });
    await registerRepo(context, repoDir);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    const card = worktreeCard(window, "2 existing sessions");
    await expect(card).toContainText("many-suggestions");
    await card.click();
    await expect(visibleWorktreeView(window).locator(".suggested-session-action")).toHaveCount(2);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("provider store から消えた primary session は通知して detach される", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "missing-primary");
    await registerRepo(context, repoDir, [
      {
        worktreePath,
        primarySessions: [
          { provider: "claude", agentSessionId: "missing-claude-session" },
          { provider: "codex", agentSessionId: "missing-codex-session" },
        ],
      },
    ]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    const card = worktreeCard(window, "(no messages)");
    await expect(card.locator('[aria-label="Claude primary session inactive"]')).toBeVisible();
    // 選択では resume しないため、detach は Terminal からの明示 resume で起こる。
    await card.click();
    const sessionView = visibleWorktreeView(window);
    await sessionView
      .locator(".session-home-row", { hasText: "Claude" })
      .locator(".resume-primary-action")
      .click();

    const toast = window.locator(".app-error-toast");
    await expect(toast).toContainText("This session no longer exists.");
    await expect(toast).toContainText(
      "claude session missing-claude-session was not found in saved conversations.",
    );

    await expect(
      sessionView.locator(".session-home-row", { hasText: "Claude" }),
    ).toHaveCount(0);
    await expect(sessionView.locator(".session-home-row", { hasText: "Codex" })).toBeVisible();
    await expect(window.locator(".sidebar-errors-row .error-count-badge:not(.warning)")).toHaveText(
      "1",
    );

    await toast.locator(".icon-button").click();
    await expect(toast).toHaveCount(0);

    await sessionView
      .locator(".session-home-row", { hasText: "Codex" })
      .locator(".resume-primary-action")
      .click();
    await expect(toast).toContainText(
      "codex session missing-codex-session was not found in saved conversations.",
    );
    await expect(toast).toHaveCount(0, { timeout: 7_000 });

    await expect(worktreeCard(window, "missing-primary")).toContainText("empty");
    const metadata = await readMetadata(context);
    expect(metadata.taskWorktrees[0].primarySessions).toEqual([]);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
