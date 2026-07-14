import { expect, test, type ElectronApplication } from "@playwright/test";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  expectPreviewPath,
  launchWindow,
  openMainTerminal,
  registerRepo,
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
    await expect(window.locator(".file-search-input")).toBeVisible();
    await window.locator(".file-search-input").fill("app");
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
    await expect(window.locator(".panel-tab.active", { hasText: "Search" })).toBeVisible();
    await expect(window.locator(".code-search-input")).toBeFocused();
    await window.locator(".code-search-input").fill("YURU_NEEDLE");

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
    await window.locator(".file-search-input").fill("target");
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
    await window.locator(".code-search-input").fill("YURU_MULTI_MATCH");
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
    await window.locator(".code-search-input").fill("YURU_NO_SUCH_MATCH");

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
    const input = window.locator(".code-search-input");
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
