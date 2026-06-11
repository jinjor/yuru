import { expect, test, type ElectronApplication } from "@playwright/test";
import { rm } from "node:fs/promises";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  createGitWorktree,
  git,
  launchWindow,
  openMainTerminal,
  registerRepo,
  writeFiles,
} from "./helpers";

test("Files タブで追跡ファイルを表示しクリックしたファイルをプレビューする", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# e2e\n",
      "src/app.ts": "export const needle = 1;\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".panel-tab", { hasText: "Files" }).click();
    await expect(window.locator(".file-tree-name", { hasText: "README.md" })).toBeVisible();
    await expect(window.locator(".file-tree-name", { hasText: "src" })).toBeVisible();

    await writeFiles(repoDir, { "later.txt": "created after Files opened\n" });
    await expect(window.locator(".file-tree-name", { hasText: "later.txt" })).toBeVisible({
      timeout: 10_000,
    });

    await window.locator(".file-tree-row", { hasText: "src" }).click();
    await expect(window.locator(".file-tree-name", { hasText: "app.ts" })).toBeVisible();
    await window.locator(".file-tree-row", { hasText: "app.ts" }).click();

    await expect(window.locator(".preview-path")).toHaveText("src/app.ts");
    await expect(window.locator(".source-viewer")).toContainText("needle");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("Changes タブで変更ファイルと未追跡ファイルを表示し diff を開く", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# original\n",
      "src/app.ts": "export const stable = true;\n",
    });
    await writeFiles(repoDir, {
      "README.md": "# changed\n",
      "notes.txt": "untracked\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await expect(window.locator(".panel-tab.active", { hasText: "Changes" })).toBeVisible();
    await expect(window.locator(".change-item", { hasText: "README.md" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(window.locator(".change-item", { hasText: "notes.txt" })).toBeVisible();
    await expect(window.locator(".change-status", { hasText: "U" })).toBeVisible();

    await window.locator(".change-item", { hasText: "README.md" }).click();
    await expect(window.locator(".preview-path")).toHaveText("README.md");
    await expect(window.locator(".source-line.diff-deleted")).toContainText("# original");
    await expect(window.locator(".source-line.diff-added")).toContainText("# changed");

    await writeFiles(repoDir, { "README.md": "# changed again\n" });
    await expect(window.locator(".source-line.diff-added")).toContainText("# changed again", {
      timeout: 7_000,
    });

    await window.getByLabel("Close code panel").click();
    await expect(window.locator(".preview-panel")).toBeHidden();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("Files タブには選択中 worktree のファイルだけが出る", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "main-only.txt": "main\n",
    });
    const taskWorktreePath = await createGitWorktree(context, repoDir, "task-files-only");
    await writeFiles(taskWorktreePath, { "task-only.txt": "task\n" });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".panel-tab", { hasText: "Files" }).click();
    await expect(window.locator(".file-tree-name", { hasText: "main-only.txt" })).toBeVisible();
    await expect(window.locator(".file-tree-name", { hasText: "task-only.txt" })).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("Changed dirs で変更ファイルのディレクトリだけを展開し Collapse all で閉じる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "src/nested/app.ts": "export const value = 1;\n",
      "README.md": "# stable\n",
    });
    await writeFiles(repoDir, {
      "src/nested/app.ts": "export const value = 2;\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".panel-tab", { hasText: "Files" }).click();
    await window.locator(".panel-header-action", { hasText: "Changed dirs" }).click();
    await expect(window.locator(".file-tree-name", { hasText: "src" })).toBeVisible();
    await expect(window.locator(".file-tree-name", { hasText: "nested" })).toBeVisible();
    await expect(window.locator(".file-tree-name", { hasText: "app.ts" })).toBeVisible();

    await window.locator(".panel-header-action", { hasText: "Collapse all" }).click();
    await expect(window.locator(".file-tree-name", { hasText: "app.ts" })).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("Changes タブは staged と unstaged を別セクションで表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# original\n",
      "src/app.ts": "export const value = 1;\n",
    });
    await writeFiles(repoDir, {
      "README.md": "# staged\n",
      "src/app.ts": "export const value = 2;\n",
    });
    git(["add", "README.md"], repoDir);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await expect(window.locator(".change-section-header", { hasText: /^Staged1$/ })).toBeVisible({
      timeout: 10_000,
    });
    await expect(window.locator(".change-section-header", { hasText: /^Unstaged1$/ })).toBeVisible();
    await expect(window.locator(".change-item", { hasText: "README.md" })).toContainText("M");
    await expect(window.locator(".change-item", { hasText: "app.ts" })).toContainText("M");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("Changes タブは変更が無いと No changes を表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await expect(window.locator(".empty-changes")).toHaveText("No changes");
    await expect(window.locator(".panel-tab.active", { hasText: "Changes" })).toContainText("0");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("Changes タブは削除ファイルを D として表示し diff を開く", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "delete-me.txt": "deleted content\n",
    });
    await rm(`${repoDir}/delete-me.txt`);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    const changeItem = window.locator(".change-item", { hasText: "delete-me.txt" });
    await expect(changeItem).toContainText("D", { timeout: 10_000 });
    await changeItem.click();

    await expect(window.locator(".preview-path")).toHaveText("delete-me.txt");
    await expect(window.locator(".source-line.diff-deleted")).toContainText("deleted content");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
