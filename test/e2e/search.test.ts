import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  createGitWorktree,
  expectPreviewPath,
  launchWindow,
  openMainTerminal,
  registerRepo,
  visibleWorktreeView,
  worktreeCard,
  writeFiles,
} from "./helpers";

test("Cmd+P でファイル検索パレットを開き選択したファイルをプレビューする", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# e2e\n",
      "src/app.ts": "export const paletteTarget = true;\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.keyboard.press("Meta+P");
    await expect(window.locator(".file-search .text-input")).toBeVisible();
    await window.locator(".file-search .text-input").fill("app");
    await expect(window.locator(".file-search-row", { hasText: "app.ts" })).toBeVisible();

    await window.locator(".file-search-row", { hasText: "app.ts" }).click();
    await expect(window.locator(".file-search")).toBeHidden();
    await expectPreviewPath(window, "src/app.ts");

    await window.keyboard.press("Meta+P");
    await expect(window.locator(".file-search")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.locator(".file-search")).toBeHidden();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("Cmd+Shift+F で code search を開き結果をプレビューする", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# e2e\n",
      "src/app.ts": "export const searchNeedle = 'YURU_NEEDLE';\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.keyboard.press("Meta+Shift+F");
    await expect(window.locator(".panel-tabs .tab.selected", { hasText: "Search" })).toBeVisible();
    await expect(window.locator(".code-search-input-wrap .text-input")).toBeFocused();
    await window.locator(".code-search-input-wrap .text-input").fill("YURU_NEEDLE");

    await expect(window.locator(".code-search-status")).toContainText("1 matches", {
      timeout: 10_000,
    });
    await expect(window.locator(".code-search-file-header")).toContainText("app.ts");
    await window.locator(".code-search-match-row").click();
    await expectPreviewPath(window, "src/app.ts");
    await expect(window.locator(".source-line.highlight")).toContainText("YURU_NEEDLE");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("ファイル検索パレットは空入力のとき最近開いたファイルを repo 共通で出し、再起動後も残す", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# e2e\n",
      "src/recent-one.ts": "export const label = 'from main worktree';\n",
      "src/recent-two.ts": "export const two = 2;\n",
    });
    const otherWorktree = await createGitWorktree(context, repoDir, "recent-other");
    await writeFiles(otherWorktree, {
      "src/recent-one.ts": "export const label = 'from other worktree';\n",
    });
    await registerRepo(context, repoDir, [{ worktreePath: otherWorktree }]);

    let launched = await launchWindow(context);
    app = launched.app;
    await openMainTerminal(launched.window);

    await openFromPalette(launched.window, "recent-one", "src/recent-one.ts");
    await openFromPalette(launched.window, "recent-two", "src/recent-two.ts");

    await closeYuru(app);
    app = null;

    launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    // 別の worktree でも、同じ repo で開いたファイルがそのまま候補になる。
    await worktreeCard(window, "recent-other").click();
    await expect(worktreeCard(window, "recent-other")).toHaveClass(/selected/);

    await window.keyboard.press("Meta+P");
    await expect(window.locator(".file-search .text-input")).toHaveValue("");
    await expect(window.locator(".file-search-row")).toHaveCount(2);
    await expect(window.locator(".file-search-row").first()).toContainText("recent-two.ts");
    await expect(window.locator(".file-search-row").nth(1)).toContainText("recent-one.ts");

    // 開くのは選択中 worktree のファイル。
    await window.locator(".file-search-row", { hasText: "recent-one.ts" }).click();
    await expectPreviewPath(window, "src/recent-one.ts");
    await expect(
      visibleWorktreeView(window).locator(".source-line", { hasText: "from other worktree" }),
    ).toBeVisible();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

async function openFromPalette(window: Page, query: string, fullPath: string): Promise<void> {
  await window.keyboard.press("Meta+P");
  await window.locator(".file-search .text-input").fill(query);
  await expect(window.locator(".file-search-row.selected", { hasText: query })).toBeVisible();
  await window.keyboard.press("Enter");
  await expect(window.locator(".file-search")).toBeHidden();
  await expectPreviewPath(window, fullPath);
}

test("ファイル検索パレットは Enter で先頭候補を開ける", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# e2e\n",
      "docs/target-note.md": "target\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.keyboard.press("Meta+P");
    await window.locator(".file-search .text-input").fill("target");
    await expect(window.locator(".file-search-row.selected", { hasText: "target-note.md" })).toBeVisible();
    await window.keyboard.press("Enter");

    await expect(window.locator(".file-search")).toBeHidden();
    await expectPreviewPath(window, "docs/target-note.md");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("code search は複数結果から別の一致行を開ける", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "src/first.ts": "export const token = 'YURU_MULTI_MATCH';\n",
      "src/second.ts": "export const token = 'YURU_MULTI_MATCH';\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.keyboard.press("Meta+Shift+F");
    await window.locator(".code-search-input-wrap .text-input").fill("YURU_MULTI_MATCH");
    await expect(window.locator(".code-search-status")).toContainText("2 matches", {
      timeout: 10_000,
    });
    await expect(window.locator(".code-search-match-row")).toHaveCount(2);
    const secondGroup = window.locator(".code-search-file-group", { hasText: "second.ts" });
    await expect(secondGroup).toBeVisible();
    await secondGroup.locator(".code-search-match-row").click();

    await expectPreviewPath(window, "src/second.ts");
    await expect(window.locator(".source-line.highlight")).toContainText("YURU_MULTI_MATCH");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("code search は空クエリと no results を表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "src/app.ts": "export const value = 'present';\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.keyboard.press("Meta+Shift+F");
    await expect(window.locator(".code-search-status")).toHaveText("No query");
    await window.locator(".code-search-input-wrap .text-input").fill("YURU_NO_SUCH_MATCH");

    await expect(window.locator(".code-search-status")).toHaveText("No results", {
      timeout: 10_000,
    });
    await expect(window.locator(".code-search-match-row")).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("code search は入力を続けた時に直前の大量の結果を残さない", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const files = Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [
        `src/broad-${String(index).padStart(3, "0")}.ts`,
        `${"a ".repeat(80)}\n`,
      ]),
    );
    files["src/narrow.ts"] = "ab\n";
    const repoDir = await createCommittedRepo(context, files);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.keyboard.press("Meta+Shift+F");
    const input = window.locator(".code-search-input-wrap .text-input");
    await input.fill("a");
    await expect(window.locator(".code-search-status")).toHaveText("Showing first 500 matches", {
      timeout: 10_000,
    });
    await expect(window.locator(".code-search-match-row")).toHaveCount(500);

    await input.fill("ab");
    await expect(window.locator(".code-search-match-row")).toHaveCount(0);
    await expect(window.locator(".code-search-status")).toHaveText("Searching...");
    await expect(window.locator(".code-search-status")).toHaveText("1 matches", {
      timeout: 10_000,
    });
    await expect(window.locator(".code-search-file-header")).toContainText("narrow.ts");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
