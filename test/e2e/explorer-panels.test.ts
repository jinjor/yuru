import { expect, test, type ElectronApplication } from "@playwright/test";
import { rm } from "node:fs/promises";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  createGitWorktree,
  expectPreviewPath,
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

    await expectPreviewPath(window, "src/app.ts");
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
    await expectPreviewPath(window, "README.md");
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

test("Changes タブは staged と unstaged を別セクションで表示し、それぞれの diff と行数を出す", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# original\n",
      "src/app.ts": "export const value = 1;\n",
    });
    await writeFiles(repoDir, { "README.md": "# staged\n" });
    git(["add", "README.md"], repoDir);
    await writeFiles(repoDir, {
      "README.md": "# unstaged\n",
      "src/app.ts": "export const value = 2;\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    // header: label + file 数 + 合計行数
    await expect(
      window.locator(".change-section-header", { hasText: /^Staged1\+1-1$/ }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      window.locator(".change-section-header", { hasText: /^Unstaged2\+2-2$/ }),
    ).toBeVisible();

    const stagedSection = window.locator(".change-section").nth(0);
    const unstagedSection = window.locator(".change-section").nth(1);
    const stagedReadme = stagedSection.locator(".change-item", { hasText: "README.md" });
    const unstagedReadme = unstagedSection.locator(".change-item", { hasText: "README.md" });
    await expect(stagedReadme).toContainText("M");
    await expect(stagedReadme.locator(".line-stat")).toHaveText("+1-1");
    await expect(unstagedSection.locator(".change-item", { hasText: "app.ts" })).toContainText("M");

    // Staged の行は HEAD ↔ index の diff を出す
    await stagedReadme.click();
    await expectPreviewPath(window, "README.md");
    await expect(window.locator(".source-line.diff-deleted")).toContainText("# original");
    await expect(window.locator(".source-line.diff-added")).toContainText("# staged");
    await expect(window.locator(".preview-header .line-stat")).toHaveText("+1-1");

    // Unstaged の行は index ↔ 作業ツリーの diff を出す
    await unstagedReadme.click();
    await expect(window.locator(".source-line.diff-deleted")).toContainText("# staged");
    await expect(window.locator(".source-line.diff-added")).toContainText("# unstaged");
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
    await expect(changeItem.locator(".line-stat")).toHaveText("-1");
    await changeItem.click();

    await expectPreviewPath(window, "delete-me.txt");
    await expect(window.locator(".source-line.diff-deleted")).toContainText("deleted content");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
