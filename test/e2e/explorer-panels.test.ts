import { expect, test, type ElectronApplication } from "@playwright/test";
import { readFile, rm } from "node:fs/promises";
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

test("Files / Search から開いた合算 diff でも Reviewed を切り替えられる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "app.ts": "export const value = 1;\n",
      "stable.ts": "export const stable = true;\n",
    });
    git(["update-ref", "refs/remotes/origin/main", "HEAD"], repoDir);
    git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], repoDir);
    await writeFiles(repoDir, { "app.ts": "export const value = 2;\n" });
    git(["add", "app.ts"], repoDir);
    await writeFiles(repoDir, {
      "app.ts": "export const scopeToggleNeedle = 3;\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".panel-tab", { hasText: "Files" }).click();
    await window.locator(".file-tree-row", { hasText: "stable.ts" }).click();
    await expectPreviewPath(window, "stable.ts");
    await expect(window.locator(".reviewed-toggle")).toHaveCount(0);

    await window.locator(".file-tree-row", { hasText: "app.ts" }).click();
    await expectPreviewPath(window, "app.ts");
    const reviewedToggle = window.locator(".reviewed-toggle");
    await expect(reviewedToggle).toHaveAttribute("aria-pressed", "false");
    await expect(reviewedToggle).toBeEnabled();
    await reviewedToggle.click();
    await expect(reviewedToggle).toHaveAttribute("aria-pressed", "true");

    await window.keyboard.press("Meta+Shift+F");
    await window.locator(".code-search-input").fill("scopeToggleNeedle");
    await expect(window.locator(".code-search-status")).toContainText("1 matches", {
      timeout: 10_000,
    });
    await window.locator(".code-search-match-row").click();
    await expectPreviewPath(window, "app.ts");
    await expect(reviewedToggle).toHaveAttribute("aria-pressed", "true");
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
    // markdown は既定でプレビューモードになるので、diff を見るために閲覧モードへ切り替える。
    await window.locator(".preview-mode-segment").getByTitle("View", { exact: true }).click();
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

test("Markdown プレビューの内容が変わらない定期更新では選択中の文字列を維持する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# before\n\ncopy this text\n",
    });
    await writeFiles(repoDir, {
      "README.md": "# after\n\ncopy this text\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".change-item", { hasText: "README.md" }).click();
    const paragraph = window.locator(".markdown-preview-body p", {
      hasText: "copy this text",
    });
    await expect(paragraph).toBeVisible();

    const selectedText = await paragraph.evaluate((element) => {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString();
    });
    expect(selectedText).toBe("copy this text");

    await window.waitForTimeout(3_500);
    expect(await window.evaluate(() => getSelection()?.toString())).toBe("copy this text");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("HTML プレビューは相対 CSS / JavaScript を読み込み Yuru 本体から隔離する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# e2e\n",
      "mock/app.js": `
const status = document.querySelector("#status");
let parentAccess = "allowed";
let evalAccess = "allowed";
let storageAccess = "blocked";
try {
  void parent.document;
} catch {
  parentAccess = "blocked";
}
try {
  eval("document.body.dataset.eval = 'ran'");
} catch {
  evalAccess = "blocked";
}
try {
  localStorage.setItem("preview", "kept");
  storageAccess = localStorage.getItem("preview");
} catch (error) {
  storageAccess = error.name;
}
status.textContent =
  "script loaded; api=" + typeof window.electronAPI +
  "; parent=" + parentAccess +
  "; eval=" + evalAccess +
  "; storage=" + storageAccess;
`,
      "mock/index.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./style.css">
  </head>
  <body>
    <p id="status">not loaded</p>
    <a id="external-link" href="https://example.com/">external</a>
    <script src="./app.js"></script>
  </body>
</html>
`,
      "mock/style.css": "#status { color: rgb(12, 34, 56); }\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".panel-tab", { hasText: "Files" }).click();
    await window.locator(".file-tree-row", { hasText: "mock" }).click();
    await window.locator(".file-tree-row", { hasText: "index.html" }).click();

    await expectPreviewPath(window, "mock/index.html");
    const iframe = window.locator(".html-preview-frame");
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");

    const preview = window.frameLocator(".html-preview-frame");
    const status = preview.locator("#status");
    const expected = "script loaded; api=undefined; parent=blocked; eval=blocked; storage=kept";
    await expect(status).toHaveText(expected);
    expect(await status.evaluate((element) => getComputedStyle(element).color)).toBe(
      "rgb(12, 34, 56)",
    );

    await preview.locator("#external-link").click();
    await expect(status).toHaveText(expected);
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

    // header: label + 合計行数 (file 数は Changes badge にだけ出す)
    await expect(
      window.locator(".change-section-header", { hasText: /^Staged\+1-1$/ }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      window.locator(".change-section-header", { hasText: /^Unstaged\+2-2$/ }),
    ).toBeVisible();

    const stagedSection = window
      .locator(".change-section")
      .filter({ has: window.locator(".change-section-header", { hasText: /^Staged/ }) });
    const unstagedSection = window
      .locator(".change-section")
      .filter({ has: window.locator(".change-section-header", { hasText: /^Unstaged/ }) });
    const stagedReadme = stagedSection.locator(".change-item", { hasText: "README.md" });
    const unstagedReadme = unstagedSection.locator(".change-item", { hasText: "README.md" });
    await expect(stagedReadme).toContainText("M");
    await expect(stagedReadme.locator(".line-stat")).toHaveText("+1-1");
    await expect(unstagedSection.locator(".change-item", { hasText: "app.ts" })).toContainText("M");

    // Staged の行は HEAD ↔ index の diff を出す
    await stagedReadme.click();
    await expectPreviewPath(window, "README.md");
    // markdown は既定でプレビューモードになるので、diff を見るために閲覧モードへ切り替える。
    // (unstaged 行へ移ってもパスが同じなのでモードは維持される)
    await window.locator(".preview-mode-segment").getByTitle("View", { exact: true }).click();
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
    git(["update-ref", "refs/remotes/origin/main", "HEAD"], repoDir);
    git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], repoDir);
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

test("local main が無ければ Committed に明示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"], repoDir);
    git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], repoDir);
    git(["switch", "-c", "feature"], repoDir);
    git(["branch", "-D", "main"], repoDir);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    const committedSection = window
      .locator(".change-section")
      .filter({ has: window.locator(".change-section-header", { hasText: "Committed" }) });
    await expect(committedSection.locator(".change-section-no-base")).toHaveText(
      "Base branch is unknown.",
      { timeout: 10_000 },
    );
    await expect(window.locator(".reviewed-toggle")).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("default branch が master でも Committed の Reviewed は commit 後と再起動後に残る", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "src/app.ts": "export const value = 1;\n",
    });
    git(["branch", "-m", "master"], repoDir);
    git(["update-ref", "refs/remotes/origin/master", "HEAD"], repoDir);
    git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"], repoDir);
    const taskWorktreePath = await createGitWorktree(context, repoDir, "feature-review");
    await writeFiles(taskWorktreePath, {
      "src/app.ts": "export const value = 2;\n",
    });
    git(["add", "src/app.ts"], taskWorktreePath);
    git(["commit", "-m", "feature"], taskWorktreePath);
    await registerRepo(context, repoDir, [{ worktreePath: taskWorktreePath }]);

    let launched = await launchWindow(context);
    app = launched.app;
    let window = launched.window;
    await window.locator(".task-worktree-card", { hasText: "feature-review" }).click();

    let committedSection = window
      .locator(".change-section")
      .filter({ has: window.locator(".change-section-header", { hasText: /^Committedmaster/ }) });
    let committedHeader = committedSection.locator(".change-section-header");
    await expect(committedHeader).toHaveAttribute("aria-expanded", "false", { timeout: 10_000 });
    await expect(committedSection.locator(".change-item")).toHaveCount(0);

    await committedHeader.click();
    let committedRow = committedSection.locator(".change-item", { hasText: "app.ts" });
    await committedRow.click();
    await expectPreviewPath(window, "src/app.ts");
    await expect(window.locator(".preview-scope-label")).toHaveText("from master");
    await expect(window.getByTitle("Committed diffs cannot be edited")).toBeDisabled();

    await window.locator(".reviewed-toggle").click();
    await expect(committedRow).toHaveClass(/reviewed/);

    // file-reviews.json は metadata と分離され、worktree path ごとに保存される。
    const stored = JSON.parse(
      await readFile(`${context.yuruHome}/file-reviews.json`, "utf8"),
    ) as { worktrees: Record<string, Record<string, string>> };
    expect(Object.keys(stored.worktrees[taskWorktreePath] ?? {})).toEqual(["src/app.ts"]);

    await closeYuru(app);
    app = null;
    launched = await launchWindow(context);
    app = launched.app;
    window = launched.window;
    await window.locator(".task-worktree-card", { hasText: "feature-review" }).click();
    committedSection = window
      .locator(".change-section")
      .filter({ has: window.locator(".change-section-header", { hasText: /^Committedmaster/ }) });
    committedHeader = committedSection.locator(".change-section-header");
    await committedHeader.click();
    committedRow = committedSection.locator(".change-item", { hasText: "app.ts" });
    await expect(committedRow).toHaveClass(/reviewed/);

    // 新しい worktree 内容は未レビューだが、承認済み HEAD の Committed 行は維持される。
    await writeFiles(taskWorktreePath, {
      "src/app.ts": "export const value = 3;\n",
    });
    const unstagedSection = window
      .locator(".change-section")
      .filter({ has: window.locator(".change-section-header", { hasText: /^Unstaged/ }) });
    const unstagedRow = unstagedSection.locator(".change-item", { hasText: "app.ts" });
    await expect(unstagedRow).toBeVisible({ timeout: 7_000 });
    await expect(unstagedRow).not.toHaveClass(/reviewed/);
    await expect(committedRow).toHaveClass(/reviewed/);

    await unstagedRow.click();
    await expect(window.locator(".preview-scope-label")).toHaveCount(0);
    await expect(window.locator(".reviewed-toggle")).toHaveAttribute("aria-pressed", "false");
    await window.locator(".reviewed-toggle").click();
    await expect(unstagedRow).toHaveClass(/reviewed/);

    git(["add", "src/app.ts"], taskWorktreePath);
    git(["commit", "-m", "feature v3"], taskWorktreePath);
    await expect(unstagedSection).toHaveCount(0, { timeout: 7_000 });
    await expect(committedRow).toHaveClass(/reviewed/);
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
