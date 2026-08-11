import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  createGitWorktree,
  launchWindow,
  registerRepo,
  visibleWorktreeView,
  worktreeCard,
} from "./helpers";

test("App の無関係な state 更新では WorktreeView を再描画しない", async () => {
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
    const sessionView = visibleWorktreeView(window);
    await expect(sessionView.locator(".terminal-session-start")).toBeVisible();
    // providers の非同期取得が props に反映された後を基準にする。
    await expect(sessionView.locator(".new-session-action").first()).toBeVisible();
    // mount 直後の git state 取得が render count に混ざらないよう、初回取得の完了を待つ。
    await window.waitForTimeout(500);
    const worktreeId = await window.evaluate(async () => {
      const repos = await window.electronAPI.getRepos();
      const worktree = repos[0]?.taskWorktrees.find((entry) => entry.name === "memo-task");
      if (!worktree) {
        throw new Error("memo-task was not found");
      }
      return worktree.worktreeId;
    });

    const before = await worktreeViewRenderCount(window, worktreeId);
    await window.locator(".sidebar-errors-row").click();
    await expect(window.locator(".error-log")).toBeVisible();
    const after = await worktreeViewRenderCount(window, worktreeId);

    expect(after).toBe(before);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

function worktreeViewRenderCount(window: Page, worktreeId: string): Promise<number> {
  return window.evaluate(
    (id) =>
      (
        globalThis as typeof globalThis & {
          __yuruWorktreeViewRenderCounts?: Record<string, number>;
        }
      ).__yuruWorktreeViewRenderCounts?.[id] ?? 0,
    worktreeId,
  );
}
