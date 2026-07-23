import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
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

// カードの ︙ メニューを開いて Remove を押し、最初の確認ダイアログを開く。
async function openRemovalDialog(window: Page, branch: string): Promise<void> {
  const card = worktreeCard(window, branch);
  await card.hover();
  await card.locator(".task-worktree-overflow").click();
  await card.locator(".task-worktree-menu-item").click();
  await expect(window.locator(".removal-dialog")).toBeVisible();
}

async function createGitRemovalTestEnv(
  context: E2eContext,
  mode: "slow" | "fail-once",
): Promise<NodeJS.ProcessEnv> {
  const binDir = path.join(context.tmpHome, "git-wrapper-bin");
  const wrapperPath = path.join(binDir, "git");
  const markerPath = path.join(context.tmpHome, "git-remove-failed");
  await mkdir(binDir, { recursive: true });
  await writeFile(
    wrapperPath,
    `#!/bin/sh
if [ "$1" = "worktree" ] && [ "$2" = "remove" ]; then
  case "\${YURU_E2E_GIT_REMOVE_MODE:-}" in
    slow)
      sleep 1.5
      ;;
    fail-once)
      if [ ! -e "$YURU_E2E_GIT_REMOVE_MARKER" ]; then
        sleep 0.5
        : > "$YURU_E2E_GIT_REMOVE_MARKER"
        echo "simulated worktree removal failure" >&2
        exit 1
      fi
      ;;
  esac
fi
exec "$YURU_E2E_REAL_GIT" "$@"
`,
  );
  await chmod(wrapperPath, 0o755);
  return {
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    YURU_E2E_REAL_GIT: execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
    YURU_E2E_GIT_REMOVE_MODE: mode,
    YURU_E2E_GIT_REMOVE_MARKER: markerPath,
  };
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

    await expect(window.locator(".removal-dialog")).toHaveCount(0);
    await expect(worktreeCard(window, "feature/remove-me")).toHaveCount(0);
    expect(worktreePaths(context, repoDir)).not.toContain(worktreePath);
    const metadata = await readMetadata(context);
    expect(metadata.taskWorktrees).toHaveLength(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("worktree1 の実削除中に開いた worktree2 のモーダルは完了後も残る", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktree1Path = await createGitWorktree(context, repoDir, "feature/remove-one");
    const worktree2Path = await createGitWorktree(context, repoDir, "feature/remove-two");
    await registerRepo(context, repoDir, [
      { worktreePath: worktree1Path },
      { worktreePath: worktree2Path },
    ]);

    const launched = await launchWindow(context, {
      env: await createGitRemovalTestEnv(context, "slow"),
    });
    app = launched.app;
    const window = launched.window;

    await openRemovalDialog(window, "feature/remove-one");
    await window.locator(".removal-btn.danger").click();

    const removingCard = worktreeCard(window, "feature/remove-one");
    await expect(window.locator(".removal-dialog")).toHaveCount(0);
    await expect(removingCard).toHaveClass(/removing/);
    await expect(removingCard).toContainText("Removing…");
    await expect(removingCard).toHaveAttribute("aria-disabled", "true");
    await expect(removingCard.locator(".task-worktree-overflow")).toHaveCount(0);

    await openRemovalDialog(window, "feature/remove-two");
    await expect(window.locator(".removal-target-name")).toContainText("feature/remove-two");

    await expect(removingCard).toHaveCount(0);
    await expect(window.locator(".removal-dialog")).toBeVisible();
    await expect(window.locator(".removal-target-name")).toContainText("feature/remove-two");
    expect(worktreePaths(context, repoDir)).not.toContain(worktree1Path);
    expect(worktreePaths(context, repoDir)).toContain(worktree2Path);
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
  // worktree を作業場所にした生きたプロセス。SIGTERM 後も少し残るため、
  // 終了確認が済むまではモーダルが閉じないことを検証できる。
  const blocker = spawn(
    process.execPath,
    [
      "-e",
      'process.on("SIGTERM", () => setTimeout(() => process.exit(0), 1500)); setInterval(() => {}, 60000);',
    ],
    { cwd: worktreePath, stdio: "ignore" },
  );
  try {
    await registerRepo(context, repoDir, [{ worktreePath }]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await openRemovalDialog(window, "feature/busy");
    await window.locator(".removal-btn.danger").click();

    // 事前確認が終わると、worktree を使っているプロセスと判断材料を改めて確認できる。
    await expect(window.locator(".removal-process-summary")).toContainText(
      "1 process is still using this worktree",
    );
    await expect(window.locator(".removal-process-item")).toHaveCount(1);
    await expect(window.locator(".removal-process-command")).toContainText("setInterval");
    await expect(window.locator(".removal-process-meta")).toHaveText(/^PID \d+$/);
    await expect(worktreeCard(window, "feature/busy")).toBeVisible();
    expect(worktreePaths(context, repoDir)).toContain(worktreePath);

    await expect(window.locator(".removal-btn.danger")).toHaveText("Stop and remove");
    await window.locator(".removal-btn.danger").click();

    await expect(window.locator(".removal-dialog")).toBeVisible();
    await expect(window.locator(".removal-btn.danger")).toBeDisabled();
    await expect(worktreeCard(window, "feature/busy")).not.toHaveClass(/removing/);

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

test("SIGTERM 後も残るプロセスがあればモーダルを維持して再操作できる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  const repoDir = await createCommittedRepo(context);
  const worktreePath = await createGitWorktree(context, repoDir, "feature/stubborn");
  const blocker = spawn(
    process.execPath,
    ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 60000);'],
    { cwd: worktreePath, stdio: "ignore" },
  );
  try {
    await registerRepo(context, repoDir, [{ worktreePath }]);

    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await openRemovalDialog(window, "feature/stubborn");
    await window.locator(".removal-btn.danger").click();
    await expect(window.locator(".removal-process-item")).toHaveCount(1);

    await window.locator(".removal-btn.danger").click();
    await expect(window.locator(".removal-btn.danger")).toBeDisabled();
    await expect(window.locator(".removal-btn.danger")).toBeEnabled({ timeout: 5_000 });

    await expect(window.locator(".removal-dialog")).toBeVisible();
    await expect(window.locator(".removal-process-item")).toHaveCount(1);
    await expect(worktreeCard(window, "feature/stubborn")).not.toHaveClass(/removing/);
    expect(worktreePaths(context, repoDir)).toContain(worktreePath);
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

test("dirty な worktree は事前確認で force 確認へ切り替わり削除できる", async () => {
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

    // Remove → 実削除前の dirty 確認で、force 確認ダイアログに差し替わる
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

test("実削除中に dirty になったら warning を記録してカードを再操作可能に戻す", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "feature/became-dirty");
    await registerRepo(context, repoDir, [{ worktreePath }]);

    const launched = await launchWindow(context, {
      env: await createGitRemovalTestEnv(context, "slow"),
    });
    app = launched.app;
    const window = launched.window;

    await openRemovalDialog(window, "feature/became-dirty");
    await window.locator(".removal-btn.danger").click();
    const card = worktreeCard(window, "feature/became-dirty");
    await expect(card).toHaveClass(/removing/);

    await writeFile(path.join(worktreePath, "late-change.txt"), "changed during removal\n");

    await expect(card).not.toHaveClass(/removing/, { timeout: 5_000 });
    await expect(card).toHaveAttribute("aria-disabled", "false");
    await expect(window.locator(".removal-dialog")).toHaveCount(0);
    await expect(window.locator(".sidebar-errors-row .error-count-badge.warning")).toHaveText("1");

    await window.locator(".sidebar-errors-row").click();
    await expect(window.locator(".error-log-message")).toContainText(
      'Could not remove worktree "feature-became-dirty".',
    );
    await expect(window.locator(".error-log-detail")).toHaveText(
      "It has uncommitted changes. Try removing it again.",
    );
    await window.keyboard.press("Escape");

    // 再試行すると事前確認で dirty を検出し、明示的な force 操作で削除できる。
    await openRemovalDialog(window, "feature/became-dirty");
    await window.locator(".removal-btn.danger").click();
    await expect(window.locator(".removal-dialog-head")).toContainText("Force remove worktree");
    await window.locator(".removal-btn.danger").click();
    await expect(card).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("予期しない実削除エラーを記録してカードを再操作可能に戻す", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "feature/remove-failure");
    await registerRepo(context, repoDir, [{ worktreePath }]);

    const launched = await launchWindow(context, {
      env: await createGitRemovalTestEnv(context, "fail-once"),
    });
    app = launched.app;
    const window = launched.window;

    await openRemovalDialog(window, "feature/remove-failure");
    await window.locator(".removal-btn.danger").click();
    const card = worktreeCard(window, "feature/remove-failure");
    await expect(card).toHaveClass(/removing/);

    await expect(card).not.toHaveClass(/removing/);
    await expect(card).toHaveAttribute("aria-disabled", "false");
    await expect(window.locator(".sidebar-errors-row .error-count-badge:not(.warning)")).toHaveText(
      "1",
    );

    await window.locator(".sidebar-errors-row").click();
    await expect(window.locator(".error-log-message")).toContainText(
      "simulated worktree removal failure",
    );
    await window.keyboard.press("Escape");

    await openRemovalDialog(window, "feature/remove-failure");
    await window.locator(".removal-btn.danger").click();
    await expect(card).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
