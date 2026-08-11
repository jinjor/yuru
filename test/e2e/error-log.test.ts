import { expect, test } from "@playwright/test";
import type { ElectronAPI } from "../../src/shared/ipc";
import { closeYuru, createE2eContext, launchYuru } from "./helpers";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

test("エラーログ: 導線から一覧を開け、報告されたエラーが連続まとめ付きで表示される", async () => {
  const context = await createE2eContext();
  const app = await launchYuru(context);
  try {
    const window = await app.firstWindow();

    // 0 件でも常設の導線から開けて、空表示になる
    await window.locator(".sidebar-errors-row").click();
    await expect(window.locator(".error-log .empty-state")).toHaveText("No errors");
    await window.keyboard.press("Escape");
    await expect(window.locator(".error-log")).toHaveCount(0);

    // renderer からの報告が error center を経由してバッジに反映される
    await window.evaluate(() => {
      window.electronAPI.reportRendererError("e2e error", "detail text");
    });
    await expect(window.locator(".sidebar-errors-row .error-count-badge")).toHaveText("1");

    // 連続する同一内容は 1 行にまとまり、count pill になる
    await window.evaluate(() => {
      window.electronAPI.reportRendererError("e2e error", "detail text");
    });
    await window.locator(".sidebar-errors-row").click();
    await expect(window.locator(".error-log-row")).toHaveCount(1);
    await expect(window.locator(".error-log-count-pill")).toHaveText("2");
    await expect(window.locator(".error-log-message")).toHaveText("e2e error");
    await expect(window.locator(".error-log-detail")).toHaveText("detail text");

    // Clear all で一覧もバッジも空になる
    await window.locator(".error-log-header .button").click();
    await expect(window.locator(".error-log .empty-state")).toBeVisible();
    await expect(window.locator(".sidebar-errors-row .error-count-badge")).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
