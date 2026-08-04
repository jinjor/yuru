import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  createGitWorktree,
  launchWindow,
  registerRepo,
  worktreeCard,
} from "./helpers";

test("App の無関係な state 更新では SessionView を再描画しない", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "memo-task");
    await registerRepo(context, repoDir, [{ worktreePath }]);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await worktreeCard(window, "memo-task").click();
    await expect(window.locator(".terminal-session-start")).toBeVisible();
    // providers の非同期取得が props に反映された後を基準にする。
    await expect(window.locator(".new-session-action").first()).toBeVisible();

    const before = await totalSessionViewRenderCount(window);
    await window.locator(".sidebar-errors-row").click();
    await expect(window.locator(".error-log")).toBeVisible();
    const after = await totalSessionViewRenderCount(window);

    expect(after).toBe(before);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

function totalSessionViewRenderCount(window: Page): Promise<number> {
  return window.evaluate(() => {
    const counts = (
      globalThis as typeof globalThis & {
        __yuruSessionViewRenderCounts?: Record<string, number>;
      }
    ).__yuruSessionViewRenderCounts;
    return Object.values(counts ?? {}).reduce((total, count) => total + count, 0);
  });
}
