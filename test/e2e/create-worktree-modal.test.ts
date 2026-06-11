import { expect, test, type ElectronApplication } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  git,
  launchWindow,
  registerRepo,
} from "./helpers";

test("＋ボタンで Create Worktree モーダルが開き Escape と外側クリックで閉じる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await window.locator(".repo-row-new-btn").click();
    await expect(window.locator(".repo-picker-header")).toHaveText("Create Worktree");
    await expect(window.locator(".provider-picker-btn", { hasText: "Claude" })).toBeVisible();
    await expect(window.locator(".provider-picker-btn", { hasText: "Codex" })).toBeVisible();

    const input = window.locator(".worktree-name-input");
    await expect(input).toHaveValue(/^work-\d{4}-\d{6}$/);
    await expect(input).toBeFocused();
    expect(
      await input.evaluate((element) => {
        const inputElement = element as HTMLInputElement;
        return inputElement.selectionStart === 0 && inputElement.selectionEnd === inputElement.value.length;
      }),
    ).toBe(true);

    await input.fill("bad branch");
    await expect(window.locator(".worktree-error")).toContainText(
      "Letters, digits, dots, underscores, slashes, dashes only",
    );
    await expect(window.locator(".worktree-create-btn")).toBeDisabled();

    await input.fill("feature/");
    await expect(window.locator(".worktree-create-btn")).toBeDisabled();

    await input.press("Escape");
    await expect(window.locator(".repo-picker")).toBeHidden();

    await window.locator(".repo-row-new-btn").click();
    await expect(window.locator(".repo-picker")).toBeVisible();
    await window.locator(".modal-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(window.locator(".repo-picker")).toBeHidden();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("既存 branch 名で作成するとエラーを出してモーダルを維持する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    git(["branch", "already-there"], repoDir);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await window.locator(".repo-row-new-btn").click();
    await window.locator(".worktree-name-input").fill("already-there");
    await window.locator(".worktree-create-btn").click();

    await expect(window.locator(".repo-picker")).toBeVisible();
    await expect(window.locator(".worktree-error")).toContainText(
      'Branch "already-there" already exists',
    );
    await expect(
      window.locator(".task-worktree-card", { hasText: "already-there" }),
    ).toHaveCount(0);
    expect(existsSync(path.join(repoDir, ".claude", "worktrees", "already-there"))).toBe(false);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("空の branch 名では Create が無効になる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await window.locator(".repo-row-new-btn").click();
    await window.locator(".worktree-name-input").fill("   ");

    await expect(window.locator(".worktree-create-btn")).toBeDisabled();
    await expect(window.locator(".worktree-error")).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("worktree directory が既にあるとエラーを出して作成しない", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const existingWorktreeDir = path.join(repoDir, ".claude", "worktrees", "directory-exists");
    await mkdir(existingWorktreeDir, { recursive: true });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await window.locator(".repo-row-new-btn").click();
    await window.locator(".worktree-name-input").fill("directory-exists");
    await window.locator(".worktree-create-btn").click();

    await expect(window.locator(".repo-picker")).toBeVisible();
    await expect(window.locator(".worktree-error")).toContainText(
      'Worktree "directory-exists" already exists',
    );
    await expect(
      window.locator(".task-worktree-card", { hasText: "directory-exists" }),
    ).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
