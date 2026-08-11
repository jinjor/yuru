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
    await expect(window.locator(".sidebar-section .empty-state")).toBeVisible();
    const browserWindowState = await app.evaluate(async ({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      return {
        backgroundThrottling: browserWindow.webContents.getBackgroundThrottling(),
        isFocused: browserWindow.isFocused(),
        isVisible: browserWindow.isVisible(),
      };
    });
    expect(browserWindowState).toEqual({
      backgroundThrottling: false,
      isFocused: false,
      isVisible: false,
    });
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("通常の BrowserWindow 設定では background throttling が有効になる", async () => {
  const context = await createE2eContext();
  const app = await launchYuru(context, { disableBackgroundThrottlingForE2e: false });
  try {
    await app.firstWindow();
    const backgroundThrottling = await app.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling();
    });
    expect(backgroundThrottling).toBe(true);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
