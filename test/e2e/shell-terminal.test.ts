import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  launchWindow,
  openMainTerminal,
  registerRepo,
  visibleWorktreeView,
  worktreeCard,
  writeMetadata,
} from "./helpers";

test("main worktree の standalone terminal を開いて入力と exit を扱える", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await openMainTerminal(window);
    const sessionView = visibleWorktreeView(window);
    await expect(sessionView.locator(".terminal-bar-branch")).toContainText("main");

    await sessionView.locator(".xterm").click();
    await window.keyboard.type("printf 'YURU_ECHO_OK\\n'");
    await window.keyboard.press("Enter");
    await expect(sessionView.locator(".xterm")).toContainText("YURU_ECHO_OK", {
      timeout: 10_000,
    });

    // terminal が終了しても worktree の選択は保たれ、Terminal は
    // Open Terminal を出す session start surface に戻る。
    await window.keyboard.type("exit");
    await window.keyboard.press("Enter");
    await expect(sessionView.locator(".open-terminal-action")).toBeVisible({ timeout: 10_000 });
    await expect(sessionView.locator(".xterm")).toHaveCount(0);

    // Open Terminal で同じ worktree に新しい terminal を開き直せる。
    await sessionView.locator(".open-terminal-action").click();
    await expect(sessionView.locator(".xterm")).toBeVisible({ timeout: 10_000 });
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("worktree 選択を切り替えると対応する terminal runtime に切り替わる", async () => {
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

    await mainTerminalCardForRepo(window, firstRepo).click();
    const sessionView = visibleWorktreeView(window);
    await expect(sessionView.locator(".xterm")).toBeVisible({ timeout: 10_000 });
    await sessionView.locator(".xterm").click();
    await window.keyboard.type("printf 'FIRST_RUNTIME\\n'");
    await window.keyboard.press("Enter");
    await expect(sessionView.locator(".xterm")).toContainText("FIRST_RUNTIME", {
      timeout: 10_000,
    });

    await mainTerminalCardForRepo(window, secondRepo).click();
    await expect(sessionView.locator(".xterm")).toBeVisible({ timeout: 10_000 });
    // Wait until the second runtime has rendered its own shell prompt (which shows
    // that repo's directory) before typing. Otherwise the first terminal is still
    // mounted/focused during the switch and the keystrokes land in it.
    await expect(sessionView.locator(".xterm")).toContainText(path.basename(secondRepo), {
      timeout: 10_000,
    });
    await sessionView.locator(".xterm").click();
    await window.keyboard.type("printf 'SECOND_RUNTIME\\n'");
    await window.keyboard.press("Enter");
    await expect(sessionView.locator(".xterm")).toContainText("SECOND_RUNTIME", {
      timeout: 10_000,
    });

    await mainTerminalCardForRepo(window, firstRepo).click();
    await expect(sessionView.locator(".xterm")).toContainText("FIRST_RUNTIME", {
      timeout: 10_000,
    });
    // Run a fresh command on the re-selected runtime and wait for its echo. This
    // anchors the negative assertion below: by the time the new output appears,
    // any (buggy) leaked output from the other runtime would already have surfaced,
    // so checking absence here is not racing against late-arriving data.
    await sessionView.locator(".xterm").click();
    await window.keyboard.type("printf 'BACK_ON_FIRST\\n'");
    await window.keyboard.press("Enter");
    await expect(sessionView.locator(".xterm")).toContainText("BACK_ON_FIRST", {
      timeout: 10_000,
    });
    await expect(sessionView.locator(".xterm")).not.toContainText("SECOND_RUNTIME");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("main worktree の terminal から現在の repo と別の repo に worktree を作成できる", async () => {
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

    await mainTerminalCardForRepo(window, firstRepo).click();
    const sessionView = visibleWorktreeView(window);
    await expect(sessionView.locator(".xterm")).toBeVisible({ timeout: 10_000 });
    await sessionView.locator(".xterm").click();
    await window.keyboard.type('node "$YURU_CLI" worktree create current-repo-api');
    await window.keyboard.press("Enter");

    const currentWorktreePath = path.join(firstRepo, ".yuru", "worktrees", "current-repo-api");
    await expect(sessionView.locator(".xterm")).toContainText(
      `Created worktree ${currentWorktreePath}`,
      { timeout: 10_000 },
    );
    await expect(worktreeCard(window, "current-repo-api")).toBeVisible();
    expect(existsSync(currentWorktreePath)).toBe(true);

    await sessionView.locator(".xterm").click();
    await window.keyboard.type(
      `node "$YURU_CLI" worktree create cross-repo-api --repo ${JSON.stringify(secondRepo)}`,
    );
    await window.keyboard.press("Enter");

    const crossRepoWorktreePath = path.join(secondRepo, ".yuru", "worktrees", "cross-repo-api");
    await expect(sessionView.locator(".xterm")).toContainText(
      `Created worktree ${crossRepoWorktreePath}`,
      { timeout: 10_000 },
    );
    await expect(
      window
        .locator(".repo-group", { hasText: secondRepo })
        .locator(".task-worktree-card", { hasText: "cross-repo-api" }),
    ).toBeVisible();
    expect(existsSync(crossRepoWorktreePath)).toBe(true);
    expect(existsSync(path.join(firstRepo, ".yuru", "worktrees", "cross-repo-api"))).toBe(false);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

function mainTerminalCardForRepo(window: Page, repoPath: string) {
  return window
    .locator(".repo-group", { hasText: repoPath })
    .locator(".task-worktree-card", { hasText: "terminal" });
}
