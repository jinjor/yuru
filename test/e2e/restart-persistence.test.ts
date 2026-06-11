import { expect, test, type ElectronApplication } from "@playwright/test";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  createGitWorktree,
  launchWindow,
  readMetadata,
  registerRepo,
  writeMetadata,
} from "./helpers";

test("再起動後も metadata は残るが terminal runtime は復元しない", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);

    let launched = await launchWindow(context);
    app = launched.app;
    await expect(launched.window.locator(".repo-name")).toHaveText(path.basename(repoDir));
    await launched.window.locator(".task-worktree-card", { hasText: "terminal" }).click();
    await expect(launched.window.locator(".xterm")).toBeVisible({ timeout: 10_000 });
    await closeYuru(app);
    app = null;

    launched = await launchWindow(context);
    app = launched.app;
    await expect(launched.window.locator(".repo-name")).toHaveText(path.basename(repoDir));
    // Wait for the settled empty state first (the positive completion, mutually
    // exclusive with a terminal view), then assert no terminal surfaced. Checking
    // absence only after the app reaches its post-restart resting state avoids
    // passing before a (hypothetical) late restore.
    await expect(launched.window.locator(".terminal-empty-state")).toContainText(
      "Select a session to resume",
    );
    await expect(launched.window.locator(".xterm")).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("起動時 maintenance は stale な task worktree metadata だけを削除して repo を残す", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const liveWorktree = await createGitWorktree(context, repoDir, "live-worktree");
    const staleWorktree = path.join(repoDir, ".yuru", "worktrees", "missing-worktree");
    await writeMetadata(context, {
      repos: [{ id: "repo-1", repoPath: repoDir }],
      taskWorktrees: [
        { repoId: "repo-1", worktreePath: liveWorktree },
        { repoId: "repo-1", worktreePath: staleWorktree },
      ],
    });

    const launched = await launchWindow(context);
    app = launched.app;
    await expect(launched.window.locator(".repo-name")).toHaveText(path.basename(repoDir));
    await expect(
      launched.window.locator(".task-worktree-card", { hasText: "live-worktree" }),
    ).toBeVisible();

    const metadata = await readMetadata(context);
    expect(metadata.taskWorktrees.map((entry) => entry.worktreePath)).toEqual([liveWorktree]);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
