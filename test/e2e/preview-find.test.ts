import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  expectPreviewPath,
  launchWindow,
  openMainTerminal,
  registerRepo,
  visibleWorktreeView,
} from "./helpers";

// 検索は「見えている文字」に対して行う。強調をまたぐ needle と大文字の NEEDLE も同じ 1 語として
// 数え、段落をまたぐ endof + block は繋げない。最後の 1 件はスクロールしないと見えない位置に置く。
const findMarkdown = [
  "# find e2e",
  "",
  "alpha needle one.",
  "",
  "- list item with nee**dle** inside",
  "",
  "paragraph ending with endof",
  "",
  "block starts this paragraph.",
  "",
  "soft wrapped",
  "phrase here.",
  "",
  "spaced   words here.",
  "",
  "```",
  "code  fence",
  "```",
  "",
  ...Array.from({ length: 80 }, (_, index) => `filler line ${index}\n`),
  "last **NEEDLE** here.",
  "",
].join("\n");

test("Markdown プレビューを Cmd+F で検索できる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, { "find.md": findMarkdown });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    const sessionView = visibleWorktreeView(window);

    await sessionView.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "find.md" }).click();
    await expectPreviewPath(window, "find.md");
    await expect(sessionView.locator(".markdown-preview-body")).toContainText("alpha needle one.");

    await window.keyboard.press("Meta+F");
    await expect(sessionView.locator(".find-input")).toBeFocused();
    await sessionView.locator(".find-input").fill("needle");

    // 強調をまたぐ nee**dle** と大文字の NEEDLE も 1 件ずつ数える
    await expect(sessionView.locator(".find-count")).toHaveText("1/3");
    expect(await highlightSize(window, "markdown-find")).toBe(3);
    expect(await highlightSize(window, "markdown-find-active")).toBe(1);

    // 3 件目は下の方にあるので、選ぶとそこまでスクロールする
    const preview = sessionView.locator(".markdown-preview");
    expect(await preview.evaluate((element) => element.scrollTop)).toBe(0);
    await window.keyboard.press("Enter");
    await expect(sessionView.locator(".find-count")).toHaveText("2/3");
    await window.keyboard.press("Enter");
    await expect(sessionView.locator(".find-count")).toHaveText("3/3");
    await expect
      .poll(() => preview.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    // 段落をまたいだ文字列は繋げない
    await sessionView.locator(".find-input").fill("endofblock");
    await expect(sessionView.locator(".find-count")).toHaveText("0/0");
    expect(await highlightSize(window, "markdown-find")).toBeNull();

    // 改行や連続空白は画面上 1 個の空白なので、見えている通りの文字列で探せる
    await sessionView.locator(".find-input").fill("wrapped phrase");
    await expect(sessionView.locator(".find-count")).toHaveText("1/1");
    await sessionView.locator(".find-input").fill("spaced words");
    await expect(sessionView.locator(".find-count")).toHaveText("1/1");

    // コードブロックは書いた通りに表示されるので、空白も畳まない
    await sessionView.locator(".find-input").fill("code  fence");
    await expect(sessionView.locator(".find-count")).toHaveText("1/1");
    await sessionView.locator(".find-input").fill("code fence");
    await expect(sessionView.locator(".find-count")).toHaveText("0/0");

    // 閉じたら塗りも消える
    await window.keyboard.press("Escape");
    await expect(sessionView.locator(".find-bar")).toBeHidden();
    expect(await highlightSize(window, "markdown-find")).toBeNull();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("一致が数万件ある Markdown でも検索できる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    // 1 文字で探すと一致が数万件になる。まとめて Highlight に渡す作りだと、この数で落ちる。
    const repoDir = await createCommittedRepo(context, { "huge.md": `${"a".repeat(100_000)}\n` });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    const sessionView = visibleWorktreeView(window);

    await sessionView.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "huge.md" }).click();
    await expectPreviewPath(window, "huge.md");
    await expect(sessionView.locator(".markdown-preview-body")).toContainText("aaa");

    await window.keyboard.press("Meta+F");
    await sessionView.locator(".find-input").fill("a");
    await expect(sessionView.locator(".find-count")).toHaveText("1/100000", { timeout: 30_000 });
    expect(await highlightSize(window, "markdown-find")).toBe(100_000);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("閲覧モードのファイル内検索も Cmd+F で使える", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "app.ts": "export const needle = 1;\nexport const other = needle + 1;\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    const sessionView = visibleWorktreeView(window);

    await sessionView.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "app.ts" }).click();
    await expectPreviewPath(window, "app.ts");
    await expect(sessionView.locator(".source-line")).toHaveCount(3);

    await window.keyboard.press("Meta+F");
    await sessionView.locator(".find-input").fill("needle");
    await expect(sessionView.locator(".find-count")).toHaveText("1/2");
    await expect(sessionView.locator(".source-find-match")).toHaveCount(2);
    await expect(sessionView.locator(".source-find-match.active")).toHaveCount(1);

    await window.keyboard.press("Enter");
    await expect(sessionView.locator(".find-count")).toHaveText("2/2");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

// CSS Custom Highlight API で塗ったマッチは DOM に出ないので、登録内容を直接数える。
// 未登録 (検索していない) なら null。
function highlightSize(window: Page, name: string): Promise<number | null> {
  return window.evaluate((highlightName) => {
    const highlight = CSS.highlights.get(highlightName);
    return highlight ? highlight.size : null;
  }, name);
}
