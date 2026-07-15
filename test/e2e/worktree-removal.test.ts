import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  createGitWorktree,
  git,
  gitOutput,
  launchWindow,
  readMetadata,
  registerRepo,
  worktreeCard,
  type E2eContext,
} from "./helpers";

// カードの ︙ メニューを開いて Remove を押すところまで。生きたプロセスのない clean な
// worktree が前提なので、確認ダイアログ (ケース A) がそのまま開く。
async function openRemovalDialog(window: Page, branch: string): Promise<void> {
  const card = worktreeCard(window, branch);
  await card.hover();
  await card.locator(".task-worktree-overflow").click();
  await card.locator(".task-worktree-menu-item").click();
  await expect(window.locator(".removal-dialog")).toBeVisible();
}

function worktreePaths(context: E2eContext, repoDir: string): string[] {
  return gitOutput(["worktree", "list", "--porcelain"], repoDir)
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

test("clean な worktree を ︙ メニューから削除すると一覧・metadata・git から消える", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "feature/remove-me");
    await registerRepo(context, repoDir, [{ worktreePath }]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await expect(worktreeCard(window, "feature/remove-me")).toBeVisible();
    await openRemovalDialog(window, "feature/remove-me");

    await window.locator(".removal-btn.danger").click();

    await expect(worktreeCard(window, "feature/remove-me")).toHaveCount(0);
    expect(worktreePaths(context, repoDir)).not.toContain(worktreePath);
    const metadata = await readMetadata(context);
    expect(metadata.taskWorktrees).toHaveLength(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("worktree を cwd にしたプロセスの詳細を確認して停止・削除できる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  const repoDir = await createCommittedRepo(context);
  const worktreePath = await createGitWorktree(context, repoDir, "feature/busy");
  // worktree を作業場所にした生きたプロセス (削除直前の OS チェックで検出される)
  const blocker = spawn("sleep", ["60"], { cwd: worktreePath, stdio: "ignore" });
  try {
    await registerRepo(context, repoDir, [{ worktreePath }]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await openRemovalDialog(window, "feature/busy");
    await window.locator(".removal-btn.danger").click();

    // 同じダイアログ内で、worktree を使っているプロセスと判断材料を確認できる。
    await expect(window.locator(".removal-process-summary")).toContainText(
      "1 process is still using this worktree",
    );
    await expect(window.locator(".removal-process-item")).toHaveCount(1);
    await expect(window.locator(".removal-process-command")).toContainText("sleep 60");
    await expect(window.locator(".removal-process-meta")).toHaveText(/^PID \d+$/);
    await expect(worktreeCard(window, "feature/busy")).toBeVisible();
    expect(worktreePaths(context, repoDir)).toContain(worktreePath);

    await expect(window.locator(".removal-btn.danger")).toHaveText("Stop and remove");
    await window.locator(".removal-btn.danger").click();

    await expect(worktreeCard(window, "feature/busy")).toHaveCount(0);
    expect(worktreePaths(context, repoDir)).not.toContain(worktreePath);
    await expect.poll(() => blocker.exitCode !== null || blocker.signalCode !== null).toBe(true);
  } finally {
    if (blocker.exitCode === null && blocker.signalCode === null) {
      blocker.kill("SIGKILL");
    }
    await closeYuru(app);
    await context.cleanup();
  }
});

test("複数の残存プロセスを一覧で確認してすべて停止・削除できる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  const repoDir = await createCommittedRepo(context);
  const worktreePath = await createGitWorktree(context, repoDir, "feature/multiple-busy");
  const blockers = [
    spawn("sleep", ["60"], { cwd: worktreePath, stdio: "ignore" }),
    spawn("sleep", ["61"], { cwd: worktreePath, stdio: "ignore" }),
  ];
  try {
    await registerRepo(context, repoDir, [{ worktreePath }]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await openRemovalDialog(window, "feature/multiple-busy");
    await window.locator(".removal-btn.danger").click();

    await expect(window.locator(".removal-process-summary")).toContainText(
      "2 processes are still using this worktree",
    );
    await expect(window.locator(".removal-process-item")).toHaveCount(2);
    await expect(window.locator(".removal-btn.danger")).toHaveText("Stop all and remove");

    await window.locator(".removal-btn.danger").click();

    await expect(worktreeCard(window, "feature/multiple-busy")).toHaveCount(0);
    expect(worktreePaths(context, repoDir)).not.toContain(worktreePath);
    await expect
      .poll(() =>
        blockers.every((blocker) => blocker.exitCode !== null || blocker.signalCode !== null),
      )
      .toBe(true);
  } finally {
    for (const blocker of blockers) {
      if (blocker.exitCode === null && blocker.signalCode === null) {
        blocker.kill("SIGKILL");
      }
    }
    await closeYuru(app);
    await context.cleanup();
  }
});

test("残留ロックのある worktree は unlock を挟んで削除できる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "feature/stale-lock");
    // ロックをかけたプロセスが異常終了した状況を再現する (ロックは .git 配下のファイルとして残る)
    git(
      ["worktree", "lock", "--reason", "claude session stale (pid 1 start now)", worktreePath],
      repoDir,
    );
    await registerRepo(context, repoDir, [{ worktreePath }]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await openRemovalDialog(window, "feature/stale-lock");
    await window.locator(".removal-btn.danger").click();

    await expect(worktreeCard(window, "feature/stale-lock")).toHaveCount(0);
    expect(worktreePaths(context, repoDir)).not.toContain(worktreePath);
    const metadata = await readMetadata(context);
    expect(metadata.taskWorktrees).toHaveLength(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("dirty な worktree は通常削除が拒否され force 確認を経て削除できる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "feature/dirty");
    // untracked file を置いて dirty にする → 通常の `git worktree remove` は拒否される
    await writeFile(path.join(worktreePath, "scratch.txt"), "work in progress\n");
    await registerRepo(context, repoDir, [{ worktreePath }]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await openRemovalDialog(window, "feature/dirty");

    // Remove → git に dirty で拒否され、force 確認ダイアログに差し替わる
    await window.locator(".removal-btn.danger").click();
    await expect(window.locator(".removal-dialog-head")).toContainText("Force remove worktree");
    await expect(window.locator(".removal-note.force")).toBeVisible();

    await window.locator(".removal-btn.danger").click();

    await expect(worktreeCard(window, "feature/dirty")).toHaveCount(0);
    expect(worktreePaths(context, repoDir)).not.toContain(worktreePath);
    const metadata = await readMetadata(context);
    expect(metadata.taskWorktrees).toHaveLength(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
