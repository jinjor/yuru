import { expect, test, type ElectronApplication } from "@playwright/test";
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

// 並び替えは Yuru metadata の primary session の順を書くだけなので、実プロバイダは要らない。
// inactive な primary session を 2 つ仕込んでホームの行をドラッグする。
test("ホームの session 行をドラッグすると並びが変わり metadata にも保存される", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "feat-order");
    await registerRepo(context, repoDir, [
      {
        worktreePath,
        primarySessions: [
          { provider: "claude", agentSessionId: "order-session-1" },
          { provider: "codex", agentSessionId: "order-session-2" },
        ],
      },
    ]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await worktreeCard(window, "feat-order").click();
    const sessionView = visibleWorktreeView(window);
    const rowMeta = sessionView.locator(".session-home-row .action-surface-row-meta");
    await expect(rowMeta).toHaveText(["Claude · inactive", "Codex · inactive"]);

    const claudeRowBox = await sessionView
      .locator(".session-home-row", { hasText: "Claude" })
      .boundingBox();
    const codexRow = sessionView.locator(".session-home-row", { hasText: "Codex" });
    const codexRowBox = await codexRow.boundingBox();
    expect(claudeRowBox).not.toBeNull();
    expect(codexRowBox).not.toBeNull();
    const startX = codexRowBox!.x + codexRowBox!.width / 2;
    await window.mouse.move(startX, codexRowBox!.y + codexRowBox!.height / 2);
    await window.mouse.down();
    // 先頭の行の位置まで上げると、その手前に落ちる。
    await window.mouse.move(startX, claudeRowBox!.y + claudeRowBox!.height / 2, { steps: 8 });
    await window.mouse.up();

    await expect(rowMeta).toHaveText(["Codex · inactive", "Claude · inactive"]);
    // 並び替えは session を選ばない。resume が走っていればホームから離れるか toast が出る。
    await expect(sessionView.locator(".terminal-session-start")).toBeVisible();
    await expect(window.locator(".app-error-toast")).toHaveCount(0);
    await expect
      .poll(async () =>
        (await readMetadata(context)).taskWorktrees[0].primarySessions.map(
          (session) => session.agentSessionId,
        ),
      )
      .toEqual(["order-session-2", "order-session-1"]);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
