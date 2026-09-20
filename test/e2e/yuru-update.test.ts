import { expect, test } from "@playwright/test";
import { closeYuru, createE2eContext, launchYuru } from "./helpers";

// 更新は `~/Applications/Yuru.app` を差し替えるので、その app 自身として動いている時しか
// 実行できない。e2e は開発版として起動するため、ここで見られるのは押せない状態まで。
test("開発版では Update Yuru を押せない", async () => {
  const context = await createE2eContext();
  const app = await launchYuru(context);
  try {
    const window = await app.firstWindow();
    const updateRow = window.locator(".sidebar-update-main");
    await expect(updateRow).toHaveText("Update Yuru");
    await expect(updateRow).toBeDisabled();
    await expect(updateRow).toHaveAttribute("title", /development build/);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
