import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  createGitWorktree,
  expectPreviewPath,
  git,
  launchWindow,
  registerRepo,
  seedCodexHome,
  visibleSessionView,
  worktreeCard,
} from "./helpers";

test("worktree の表示状態は session の有無に関わらず保持され、hidden 中の更新・終了・削除に追従する", async () => {
  test.setTimeout(120_000);
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# keep alive e2e\n",
      "src/kept.ts": "export const value = 'before';\n",
    });
    const idleWorktreePath = await createGitWorktree(context, repoDir, "keep-alive-idle");
    const activeWorktreePath = await createGitWorktree(context, repoDir, "keep-alive-active");
    await registerRepo(context, repoDir, [
      { worktreePath: idleWorktreePath },
      { worktreePath: activeWorktreePath },
    ]);
    await seedCodexHome(context.tmpHome, repoDir);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    const sessionView = visibleSessionView(window);

    await worktreeCard(window, "keep-alive-active").click();
    await sessionView.locator(".new-session-action", { hasText: "Codex" }).click();
    await expect(sessionView.locator(".xterm")).toContainText("OpenAI Codex", {
      timeout: 30_000,
    });
    await window.waitForTimeout(1_000);
    await expect(
      worktreeCard(window, "keep-alive-active").locator(
        '[aria-label="Codex primary session active · waiting"]',
      ),
    ).toBeVisible({ timeout: 15_000 });

    await sessionView.locator(".panel-tab", { hasText: "Files" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "src" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "kept.ts" }).click();
    await expectPreviewPath(window, "src/kept.ts");

    await worktreeCard(window, "keep-alive-idle").click();
    await expect(sessionView.locator(".terminal-session-start")).toBeVisible();
    await expect(sessionView.locator(".empty-changes")).toBeVisible();
    // mount 直後の git state 取得が render count に混ざらないよう完了を待つ。
    await window.waitForTimeout(500);

    const ids = await readKeepAliveIds(window);
    await resetRenderCounts(window, [ids.main, ids.idle, ids.active]);
    const marker = "HIDDEN_PUSH_REACHED_SIDEBAR";
    await app.evaluate(
      ({ BrowserWindow }, { runtimeId, preview }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("session:changed", runtimeId, {
          preview,
        });
      },
      { runtimeId: ids.runtime, preview: marker },
    );

    // session preview の push が App まで届いた直後に、hidden な active worktree の render
    // だけが増えて、表示中 idle と無関係な main は再描画されないことを固定する。
    await expect(
      worktreeCard(window, "keep-alive-active").locator(".task-worktree-session-preview"),
    ).toContainText(marker);
    await expect.poll(() => readRenderCount(window, ids.active)).toBeGreaterThan(0);
    expect(await readRenderCount(window, ids.idle)).toBe(0);
    expect(await readRenderCount(window, ids.main)).toBe(0);

    await writeFile(
      path.join(activeWorktreePath, "src/kept.ts"),
      "export const value = 'changed while hidden';\n",
    );
    await worktreeCard(window, "keep-alive-active").click();

    // preview・Files tab・展開済み directory は同じ instance の local state のまま残る。
    await expectPreviewPath(window, "src/kept.ts");
    await expect(sessionView.locator(".panel-tab.active", { hasText: "Files" })).toBeVisible();
    await expect(sessionView.locator(".file-tree-name", { hasText: "kept.ts" })).toBeVisible();

    // 復帰時に polling effect が即時再実行され、hidden 中の変更へ 1 周期以内に追いつく。
    await sessionView.locator(".panel-tab", { hasText: "Changes" }).click();
    const changedFile = sessionView.locator(".change-item", { hasText: "kept.ts" });
    await expect(changedFile).toBeVisible({ timeout: 4_000 });
    await changedFile.click();
    await expect(sessionView.locator(".source-line.diff-added")).toContainText(
      "changed while hidden",
    );

    // session の無い worktree でも、切り替えて戻ると Files の展開・preview が残る
    // (keep-alive の単位は worktree であって session ではない)。
    await worktreeCard(window, "keep-alive-idle").click();
    await sessionView.locator(".panel-tab", { hasText: "Files" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "src" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "kept.ts" }).click();
    await expectPreviewPath(window, "src/kept.ts");
    await worktreeCard(window, "keep-alive-active").click();
    await worktreeCard(window, "keep-alive-idle").click();
    await expect(sessionView.locator(".panel-tab.active", { hasText: "Files" })).toBeVisible();
    await expectPreviewPath(window, "src/kept.ts");

    // session が hidden 中に終了しても、worktree は訪問済みとして生き続けるので instance は
    // 破棄されない。terminal だけ死んだ runtime を指さず start surface に戻るが、
    // Explorer 側の状態 (active worktree の Changes タブ・開いていた diff) は残る。
    const preparation = await window.evaluate((worktreeId) => {
      return window.electronAPI.prepareWorktreeRemoval(worktreeId, true);
    }, ids.active);
    expect(preparation.ok).toBe(true);
    const stoppedCard = worktreeCard(window, "keep-alive-active");
    await expect(stoppedCard.locator('[aria-label^="Codex primary session active"]')).toHaveCount(
      0,
    );
    await expect(stoppedCard).toContainText("empty");
    await stoppedCard.click();
    await expect(sessionView.locator(".terminal-session-start")).toBeVisible();
    await expect(sessionView.locator(".new-session-action", { hasText: "Codex" })).toBeVisible();
    await expect(sessionView.locator(".xterm")).toHaveCount(0);
    await expect(sessionView.locator(".panel-tab.active", { hasText: "Changes" })).toBeVisible();
    await expect(sessionView.locator(".source-line.diff-added")).toContainText(
      "changed while hidden",
    );

    // 削除直前の表示状態を作り、同じ path/name で作り直しても前の instance を引き継がないことを確認する。
    await sessionView.locator(".panel-tab", { hasText: "Files" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "README.md" }).click();
    await expectPreviewPath(window, "README.md");

    git(["worktree", "remove", "--force", activeWorktreePath], repoDir);
    await expect(worktreeCard(window, "keep-alive-active")).toHaveCount(0);
    git(["branch", "-D", "keep-alive-active"], repoDir);
    git(["worktree", "add", "-b", "keep-alive-active", activeWorktreePath], repoDir);
    await expect(worktreeCard(window, "keep-alive-active")).toBeVisible();
    await worktreeCard(window, "keep-alive-active").click();

    await expect(sessionView.locator(".panel-tab.active", { hasText: "Changes" })).toBeVisible();
    await expect(sessionView.locator(".preview-panel")).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

async function readKeepAliveIds(window: Page): Promise<{
  main: string;
  idle: string;
  active: string;
  runtime: string;
}> {
  return window.evaluate(async () => {
    const repo = (await window.electronAPI.getRepos())[0];
    const idle = repo?.taskWorktrees.find((worktree) => worktree.name === "keep-alive-idle");
    const active = repo?.taskWorktrees.find((worktree) => worktree.name === "keep-alive-active");
    const runtime = active?.primarySession?.activeTerminalRuntimeId;
    if (!repo || !idle || !active || !runtime) {
      throw new Error("keep-alive E2E worktrees are not active");
    }
    return {
      main: repo.mainWorktree.worktreeId,
      idle: idle.worktreeId,
      active: active.worktreeId,
      runtime,
    };
  });
}

function resetRenderCounts(window: Page, worktreeIds: string[]): Promise<void> {
  return window.evaluate((ids) => {
    window.__yuruSessionViewRenderCounts ??= {};
    for (const id of ids) {
      window.__yuruSessionViewRenderCounts[id] = 0;
    }
  }, worktreeIds);
}

function readRenderCount(window: Page, worktreeId: string): Promise<number> {
  return window.evaluate((id) => window.__yuruSessionViewRenderCounts?.[id] ?? 0, worktreeId);
}
