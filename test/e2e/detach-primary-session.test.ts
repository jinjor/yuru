import { expect, test, type ElectronApplication } from "@playwright/test";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  createGitWorktree,
  launchWindow,
  readMetadata,
  registerRepo,
  visibleSessionView,
  worktreeCard,
} from "./helpers";

// Detach only removes the strong link in Yuru metadata, so no real provider is
// needed: seed a primary session directly and drive the session start surface.
test("inactive primary を detach すると strong link だけが外れ session の選択肢に戻る", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "feat-detach");
    await registerRepo(context, repoDir, [
      {
        worktreePath,
        primarySession: { provider: "claude", providerSessionId: "detach-session-1" },
      },
    ]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    const card = worktreeCard(window, "feat-detach");
    await expect(card.locator('[aria-label="Claude primary session inactive"]')).toBeVisible();

    // inactive primary の surface には Resume と Detach が並ぶ。
    await card.click();
    const sessionView = visibleSessionView(window);
    await expect(sessionView.locator(".resume-primary-action")).toBeVisible();
    await sessionView.locator(".detach-primary-action").click();

    // primary が外れると同じ worktree のまま既存 / 新規 session の選択肢に切り替わる。
    // (この repo には provider store が無いので Existing Session は出ない。)
    await expect(sessionView.locator(".new-session-action", { hasText: "Claude" })).toBeVisible();
    await expect(sessionView.locator(".resume-primary-action")).toHaveCount(0);
    await expect(card.locator('[aria-label="Claude primary session inactive"]')).toHaveCount(0);

    // metadata からは strong link だけが消え、task worktree の record は残る。
    const metadata = await readMetadata(context);
    expect(metadata.taskWorktrees.map((entry) => entry.worktreePath)).toEqual([worktreePath]);
    expect(metadata.taskWorktrees[0].primarySession).toBeUndefined();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
