import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  launchWindow,
  openMainTerminal,
  registerRepo,
} from "./helpers";

// 実ブラウザを開かないよう shell.openExternal を記録用スタブに差し替える。
async function stubOpenExternal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { __openedExternalUrls?: string[] }).__openedExternalUrls = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
}

function openedExternalUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () => (globalThis as { __openedExternalUrls?: string[] }).__openedExternalUrls ?? [],
  );
}

function collectDialogs(window: Page): string[] {
  const dialogs: string[] = [];
  window.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  return dialogs;
}

test("OSC 8 ハイパーリンクのクリックは確認ダイアログなしで shell.openExternal に流れる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await stubOpenExternal(app);
    const dialogs = collectDialogs(window);

    await openMainTerminal(window);
    await window.locator(".xterm").click();
    // リンクテキストをシェル変数で組み立て、echo された入力行が出力行と
    // 同じテキストにならないようにする（クリック対象の行を一意にするため）。
    await window.keyboard.type(
      "T=TARGET; printf '\\e]8;;https://example.com/osc8\\aCLICK_OSC8_'\"$T\"'\\e]8;;\\a\\n'",
    );
    await window.keyboard.press("Enter");
    const linkRow = window.locator(".xterm-rows > div", { hasText: "CLICK_OSC8_TARGET" });
    await expect(linkRow).toBeVisible({ timeout: 10_000 });

    // 行の上には xterm のオーバーレイ要素が重なっていて locator.click() は
    // hit-target チェックで進まないため、座標を計算して mouse で直接クリックする。
    // リンクは行頭から始まるので、行の左端付近を狙う。
    const box = await linkRow.boundingBox();
    if (!box) {
      throw new Error("Link row is not visible");
    }
    const x = box.x + 20;
    const y = box.y + box.height / 2;
    await window.mouse.move(x, y);
    await window.mouse.click(x, y);

    await expect.poll(() => openedExternalUrls(app!)).toEqual(["https://example.com/osc8"]);
    expect(dialogs).toEqual([]);
    expect(app.windows()).toHaveLength(1);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("renderer の window.open は Electron の子ウインドウを開かず既定ブラウザに流れる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await stubOpenExternal(app);

    await window.evaluate(() => {
      window.open("https://example.com/window-open");
    });

    await expect.poll(() => openedExternalUrls(app!)).toEqual(["https://example.com/window-open"]);
    expect(app.windows()).toHaveLength(1);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
