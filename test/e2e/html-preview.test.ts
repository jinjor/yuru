import { expect, test, type ElectronApplication, type Locator } from "@playwright/test";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  createGitWorktree,
  expectPreviewPath,
  launchWindow,
  openMainTerminal,
  registerRepo,
  writeFiles,
  worktreeCard,
} from "./helpers";

async function stubOpenExternal(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { __htmlPreviewUrls?: string[] }).__htmlPreviewUrls = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  return () =>
    app.evaluate(() => (globalThis as { __htmlPreviewUrls?: string[] }).__htmlPreviewUrls ?? []);
}

const linkHtml = `<!doctype html>
<html><body>
  <h1 id="heading">HTML link preview</h1>
  <a id="external" href="https://example.com/normal"><span>external</span></a>
  <a id="blank" href="https://example.com/blank" target="_blank">new tab</a>
  <a id="http" href="http://localhost:3000/preview">local server</a>
  <a id="anchor" href="#heading">heading</a>
  <a id="relative" href="./other.html">other page</a>
  <a id="file" href="file:///tmp/yuru-blocked.html">file</a>
  <a id="file-blank" href="file:///tmp/yuru-blocked.html" target="_blank">file tab</a>
  <a id="chrome" href="chrome://version" target="_blank">Chrome</a>
  <a id="data" href="data:text/html,blocked" target="_blank">data</a>
  <button id="script" onclick="window.open('https://example.com/script')">open</button>
</body></html>`;

for (const entry of ["Files", "Changes", "Search"] as const) {
  test(`${entry} の HTML プレビューで外部リンクをブラウザで開き内部リンクはプレビュー内に保つ`, async () => {
    const context = await createE2eContext();
    let app: ElectronApplication | null = null;
    try {
      const repoDir = await createCommittedRepo(context, {
        "index.html": "<h1>original</h1>\n",
        "other.html": '<h1>Other page</h1><a href="./index.html">back</a>\n',
      });
      await writeFiles(repoDir, { "index.html": linkHtml });
      await registerRepo(context, repoDir);
      const launched = await launchWindow(context);
      app = launched.app;
      const window = launched.window;
      // 実ブラウザの代わりに OS に渡された URL を記録する。
      const openedUrls = await stubOpenExternal(app);
      const appUrl = window.url();
      await openMainTerminal(window);

      await window.locator(".panel-tabs .tab", { hasText: entry }).click();
      if (entry === "Files") {
        await window.locator(".file-tree-row", { hasText: "index.html" }).click();
      } else if (entry === "Changes") {
        await window.locator(".change-item", { hasText: "index.html" }).click();
      } else {
        await window.locator(".code-search-input-wrap .text-input").fill("HTML link preview");
        await window.locator(".code-search-match-row").click();
        await window.getByRole("button", { name: "Preview", exact: true }).click();
      }

      await expectPreviewPath(window, "index.html");
      const preview = window.frameLocator(".html-preview-frame");
      await expect(preview.locator("h1")).toHaveText("HTML link preview");
      const expectedUrls: string[] = [];
      const clicks: Array<[string, string, Parameters<Locator["click"]>[0]]> = [
        ["#external span", "https://example.com/normal", {}],
        ["#blank", "https://example.com/blank", {}],
        ["#http", "http://localhost:3000/preview", {}],
        ["#external", "https://example.com/normal", { button: "middle" }],
        ["#external", "https://example.com/normal", { modifiers: ["ControlOrMeta"] }],
        ["#external", "https://example.com/normal", { modifiers: ["Shift"] }],
      ];
      for (const [selector, url, options] of clicks) {
        await preview.locator(selector).click(options);
        expectedUrls.push(url);
        await expect.poll(openedUrls).toEqual(expectedUrls);
        await expect(preview.locator("h1")).toHaveText("HTML link preview");
      }

      await preview.locator("#external").focus();
      await window.keyboard.press("Enter");
      expectedUrls.push("https://example.com/normal");
      await expect.poll(openedUrls).toEqual(expectedUrls);

      await preview.locator("#anchor").click();
      await expect.poll(() => preview.locator("h1").evaluate(() => location.hash)).toBe("#heading");
      await preview.locator("#file").click();
      await preview.locator("#file-blank").click();
      await preview.locator("#chrome").click();
      await preview.locator("#data").click();
      await preview.locator("#script").click();
      await preview.locator("#relative").click();
      await expect(preview.locator("h1")).toHaveText("Other page");
      await preview.getByText("back", { exact: true }).click();
      await expect(preview.locator("h1")).toHaveText("HTML link preview");
      expect(await openedUrls()).toEqual(expectedUrls);
      expect(window.url()).toBe(appUrl);
      expect(app.windows()).toHaveLength(1);
    } finally {
      await closeYuru(app);
      await context.cleanup();
    }
  });
}

test("HTML の自動処理・偽クリック・通常のボタンから外部ブラウザを起動させない", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "index.html": `<!doctype html>
<meta http-equiv="refresh" content="0;url=https://example.invalid/refresh">
<h1 id="status">starting</h1>
<a id="external" href="https://example.com/normal">external</a>
<button id="button" onclick="attack()">Show more</button>
<script>
  function attack() {
    const link = document.querySelector('#external');
    link.click();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    link.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
    window.open('https://example.invalid/popup');
    location.href = 'https://example.invalid/redirect';
  }
  attack();
  setTimeout(() => { attack(); document.querySelector('#status').textContent = 'ready'; }, 100);
</script>`,
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    const openedUrls = await stubOpenExternal(app);
    await openMainTerminal(window);
    await window.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await window.locator(".file-tree-row", { hasText: "index.html" }).click();
    const preview = window.frameLocator(".html-preview-frame");
    await expect(preview.locator("#status")).toHaveText("ready");
    expect(await openedUrls()).toEqual([]);

    // 本物のボタンクリックで user activation があっても、偽のリンク操作は受け付けない。
    await preview.locator("#button").click();
    expect(await openedUrls()).toEqual([]);

    // HTML が DOM API を上書きしても、隔離された preload の検証には影響しない。
    await preview.locator("#status").evaluate(() => {
      Event.prototype.composedPath = () => [];
      Element.prototype.getAttribute = () => "https://example.invalid/forged";
    });
    await preview.locator("#external").click();
    await expect.poll(openedUrls).toEqual(["https://example.com/normal"]);
    expect(app.windows()).toHaveLength(1);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("相対リンクで移動した HTML でもリンク操作を確認し、非表示後の自動起動を止める", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "index.html": '<h1>entry</h1><a href="./other.html">other page</a>',
      "other.html": `<!doctype html><h1>other</h1>
<a id="external" href="https://example.com/other" target="_blank">external</a>
<script>
  window.attackFinished = false;
  window.armAttack = () => setTimeout(() => {
    document.querySelector('#external').click();
    window.open('https://example.invalid/hidden-popup');
    location.href = 'https://example.invalid/hidden-redirect';
    window.attackFinished = true;
  }, 500);
</script>`,
    });
    const second = await createGitWorktree(context, repoDir, "html-links-second");
    await registerRepo(context, repoDir, [{ worktreePath: second }]);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    const openedUrls = await stubOpenExternal(app);
    await openMainTerminal(window);
    await window.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await window.locator(".file-tree-row", { hasText: "index.html" }).click();
    const preview = window.frameLocator(".html-preview-frame");
    await preview.getByText("other page", { exact: true }).click();
    await expect(preview.locator("h1")).toHaveText("other");
    await preview.locator("#external").click();
    await expect.poll(openedUrls).toEqual(["https://example.com/other"]);

    await preview
      .locator("h1")
      .evaluate(() => (window as unknown as { armAttack(): void }).armAttack());
    await worktreeCard(window, "html-links-second").click();
    await expect(window.locator(".html-preview-frame")).toBeHidden();
    await expect
      .poll(() =>
        preview
          .locator("h1")
          .evaluate(() => (window as unknown as { attackFinished: boolean }).attackFinished),
      )
      .toBe(true);
    expect(await openedUrls()).toEqual(["https://example.com/other"]);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
