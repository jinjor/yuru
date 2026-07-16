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

    await expect(window.locator(".repo-list-empty")).toHaveText("No repositories");
    await expect(window.locator(".terminal-empty-state")).toContainText("Select a worktree");
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
    await expect(window.locator(".task-worktree-card")).toHaveCount(1);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

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
        primarySession: { provider: "claude", providerSessionId: primarySessionId },
      },
    ]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    const primaryCard = worktreeCard(window, "Primary preview from store");
    await expect(primaryCard.locator('[aria-label="Claude primary session inactive"]')).toBeVisible();

    const suggestedCard = worktreeCard(window, "1 existing session");
    await expect(suggestedCard).toContainText("suggested-row");
    await suggestedCard.click();
    await expect(window.locator(".suggested-session-action")).toContainText(
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
    await expect(window.locator(".suggested-session-action")).toHaveCount(2);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("provider store から消えた primary session は選択時に detach される", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "missing-primary");
    await registerRepo(context, repoDir, [
      {
        worktreePath,
        primarySession: { provider: "claude", providerSessionId: "missing-session" },
      },
    ]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    const card = worktreeCard(window, "(no messages)");
    await expect(card.locator('[aria-label="Claude primary session inactive"]')).toBeVisible();
    // 選択では resume しないため、detach は Terminal からの明示 resume で起こる。
    await card.click();
    await window.locator(".resume-primary-action").click();

    await expect(
      worktreeCard(window, "missing-primary").locator('[aria-label="Claude primary session inactive"]'),
    ).toHaveCount(0);
    await expect(worktreeCard(window, "missing-primary")).toContainText("empty");
    const metadata = await readMetadata(context);
    expect(metadata.taskWorktrees[0].primarySession).toBeUndefined();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
