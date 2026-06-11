import { expect, test } from "@playwright/test";
import { closeYuru, createE2eContext, launchYuru } from "./helpers";

test("アプリを起動するとタイトルが Yuru になる", async () => {
  const context = await createE2eContext();
  const app = await launchYuru(context);
  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle("Yuru");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("e2e 実行中は BrowserWindow が hidden のままになる", async () => {
  const context = await createE2eContext();
  const app = await launchYuru(context);
  try {
    const window = await app.firstWindow();
    await expect(window.locator(".repo-list-empty")).toBeVisible();
    const browserWindowState = await app.evaluate(async ({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      return {
        isFocused: browserWindow.isFocused(),
        isVisible: browserWindow.isVisible(),
      };
    });
    expect(browserWindowState).toEqual({
      isFocused: false,
      isVisible: false,
    });
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
